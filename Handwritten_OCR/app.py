
import os
import base64
import uuid
import time
import qrcode

from io import BytesIO
from pathlib import Path

import cv2
import easyocr
import numpy as np

from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    send_file,
    send_from_directory
)

from werkzeug.utils import secure_filename


# ================= CẤU HÌNH =================

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp", "webp"}

# Khởi tạo OCR một lần khi máy chủ chạy
reader = easyocr.Reader(["vi", "en"], gpu=False)


# ================= HÀM HỖ TRỢ =================

def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def decode_data_url(data_url):
    """Chuyển ảnh Base64 từ trình duyệt thành ảnh OpenCV."""

    if not data_url or "," not in data_url:
        raise ValueError("Dữ liệu ảnh không hợp lệ.")

    encoded = data_url.split(",", 1)[1]
    raw = base64.b64decode(encoded)

    array = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)

    if image is None:
        raise ValueError("Không đọc được ảnh.")

    return image


def preprocess_image(image, mode="original"):
    """Tiền xử lý ảnh."""

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    if mode == "gray":
        return gray

    if mode == "denoise":
        return cv2.fastNlMeansDenoising(
            gray, None, 10, 7, 21
        )

    if mode == "threshold":
        blur = cv2.GaussianBlur(gray, (3, 3), 0)

        return cv2.adaptiveThreshold(
            blur,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            11
        )

    if mode == "sharpen":
        blur = cv2.GaussianBlur(gray, (0, 0), 2)
        return cv2.addWeighted(gray, 1.6, blur, -0.6, 0)

    return image


def perform_ocr(image, mode="original"):
    """Nhận dạng chữ viết trong ảnh."""

    processed = preprocess_image(image, mode)

    results = reader.readtext(
        processed,
        detail=1,
        paragraph=False,
        decoder="greedy"
    )

    height, width = image.shape[:2]
    detections = []

    for idx, (box, text, confidence) in enumerate(results, start=1):

        points = [
            [int(round(p[0])), int(round(p[1]))]
            for p in box
        ]

        xs = [p[0] for p in points]
        ys = [p[1] for p in points]

        x1 = max(0, min(xs))
        y1 = max(0, min(ys))
        x2 = min(width, max(xs))
        y2 = min(height, max(ys))

        detections.append({
            "id": idx,
            "text": text,
            "confidence": round(float(confidence) * 100, 2),
            "box": points,
            "x": x1,
            "y": y1,
            "width": max(0, x2 - x1),
            "height": max(0, y2 - y1)
        })

    return {
        "image_width": width,
        "image_height": height,
        "total": len(detections),
        "detections": detections,
        "full_text": "\n".join(
            item["text"] for item in detections
        )
    }


# ================= TRANG CHỦ =================

@app.route("/")
def index():
    return render_template("index.html")


# ================= API NHẬN DẠNG OCR =================

@app.route("/api/recognize", methods=["POST"])
def recognize():

    try:
        payload = request.get_json(silent=True) or {}

        image = decode_data_url(payload.get("image", ""))
        mode = payload.get("preprocess", "original")

        if mode not in {
            "original",
            "gray",
            "denoise",
            "threshold",
            "sharpen"
        }:
            mode = "original"

        result = perform_ocr(image, mode)

        result["success"] = True
        result["preprocess"] = mode

        return jsonify(result)

    except Exception as exc:
        return jsonify({
            "success": False,
            "error": str(exc)
        }), 400


# ================= API TẢI ẢNH =================

@app.route("/api/upload", methods=["POST"])
def upload():
    """Nhận ảnh tải lên từ máy tính."""

    file = request.files.get("file")

    if not file or not file.filename:
        return jsonify({
            "error": "Bạn chưa chọn ảnh."
        }), 400

    if not allowed_file(file.filename):
        return jsonify({
            "error": "Định dạng ảnh không được hỗ trợ."
        }), 400

    safe_name = secure_filename(file.filename)
    unique_name = f"{uuid.uuid4().hex}_{safe_name}"

    path = UPLOAD_DIR / unique_name
    file.save(path)

    image_bytes = path.read_bytes()

    data_url = (
        "data:image/jpeg;base64,"
        + base64.b64encode(image_bytes).decode("utf-8")
    )

    return jsonify({
        "success": True,
        "image": data_url
    })


# ================= XUẤT KẾT QUẢ =================

@app.route("/api/export/txt", methods=["POST"])
def export_txt():

    payload = request.get_json(silent=True) or {}
    content = payload.get("text", "")

    output = UPLOAD_DIR / (
        f"ocr_result_{uuid.uuid4().hex[:8]}.txt"
    )

    output.write_text(content, encoding="utf-8")

    return send_file(
        output,
        as_attachment=True,
        download_name="ket_qua_nhan_dang.txt"
    )


@app.route("/api/export/json", methods=["POST"])
def export_json():

    import json

    payload = request.get_json(silent=True) or {}

    output = UPLOAD_DIR / (
        f"ocr_result_{uuid.uuid4().hex[:8]}.json"
    )

    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    return send_file(
        output,
        as_attachment=True,
        download_name="ket_qua_nhan_dang.json"
    )


# ================= XỬ LÝ LỖI =================

@app.errorhandler(413)
def too_large(_error):

    return jsonify({
        "error": "Ảnh vượt quá giới hạn 12 MB."
    }), 413


# ================= QR CAMERA UPLOAD =================

QR_SESSIONS = {}
QR_SESSION_TIMEOUT = 600


def get_qr_session(token):

    session = QR_SESSIONS.get(token)

    if not session:
        return None

    if time.time() - session["created_at"] > QR_SESSION_TIMEOUT:
        QR_SESSIONS.pop(token, None)
        return None

    return session


# Tạo mã QR kết nối camera iPhone

@app.route("/api/qr-session", methods=["POST"])
def create_qr_session():

    token = uuid.uuid4().hex

    QR_SESSIONS[token] = {
        "created_at": time.time(),
        "image": None
    }

    public_url = os.environ.get(
        "PUBLIC_BASE_URL",
        request.host_url.rstrip("/")
    ).rstrip("/")

    mobile_url = f"{public_url}/mobile/{token}"

    qr = qrcode.make(mobile_url)

    buffer = BytesIO()
    qr.save(buffer, format="PNG")

    qr_base64 = base64.b64encode(
        buffer.getvalue()
    ).decode("utf-8")

    return jsonify({
        "token": token,
        "qr": f"data:image/png;base64,{qr_base64}",
        "mobile_url": mobile_url
    })


# Trang camera trên điện thoại

@app.route("/mobile/<token>")
def mobile_upload_page(token):

    if not get_qr_session(token):
        return "Mã QR đã hết hạn hoặc không hợp lệ", 404

    return render_template(
        "mobile.html",
        token=token
    )


# Nhận ảnh gửi từ iPhone

@app.route("/api/mobile-upload/<token>", methods=["POST"])
def mobile_upload(token):

    session = get_qr_session(token)

    if not session:
        return jsonify({
            "error": "Phiên QR đã hết hạn"
        }), 404

    if "image" not in request.files:
        return jsonify({
            "error": "Không tìm thấy ảnh"
        }), 400

    file = request.files["image"]

    if not file.filename:
        return jsonify({
            "error": "Chưa chọn ảnh"
        }), 400

    if not allowed_file(file.filename):
        return jsonify({
            "error": "Định dạng ảnh không hợp lệ"
        }), 400

    filename = secure_filename(file.filename)
    extension = Path(filename).suffix.lower()

    save_name = f"{token}{extension}"
    save_path = UPLOAD_DIR / save_name

    file.save(save_path)

    session["image"] = save_name

    return jsonify({
        "success": True,
        "message": "Tải ảnh thành công"
    })


# Kiểm tra iPhone đã gửi ảnh chưa

@app.route("/api/qr-session/<token>")
def check_qr_session(token):

    session = get_qr_session(token)

    if not session:
        return jsonify({
            "error": "Phiên QR đã hết hạn"
        }), 404

    return jsonify({
        "uploaded": session["image"] is not None,
        "image": session["image"]
    })


# Máy tính lấy ảnh đã gửi từ iPhone

@app.route("/api/qr-image/<token>")
def get_qr_image(token):

    session = get_qr_session(token)

    if not session or not session["image"]:
        return jsonify({
            "error": "Chưa có ảnh hoặc phiên QR hết hạn"
        }), 404

    return send_from_directory(
        UPLOAD_DIR,
        session["image"]
    )


# ================= CHẠY SERVER =================

if __name__ == "__main__":

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False
    )
