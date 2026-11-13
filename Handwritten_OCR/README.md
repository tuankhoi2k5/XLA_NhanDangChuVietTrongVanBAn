# Handwritten OCR System

Ứng dụng web nhận dạng văn bản trong ảnh bằng Flask, OpenCV và EasyOCR.

## Chức năng
- Mở webcam laptop hoặc camera điện thoại.
- Chụp ảnh trực tiếp hoặc tải ảnh từ máy.
- Tiền xử lý: ảnh gốc, grayscale, khử nhiễu, threshold, sharpen.
- Nhận dạng tiếng Việt và tiếng Anh bằng EasyOCR.
- Vẽ bounding box cho từng vùng chữ.
- Tìm kiếm từ khóa và tô đỏ vùng khớp.
- Thống kê tọa độ, kích thước, độ tin cậy.
- Sao chép kết quả và tải TXT/JSON.

## Cài đặt trên Windows
```powershell
py -m venv venv
venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```
Mở http://127.0.0.1:5000

## Camera trên điện thoại
Camera trình duyệt thường chỉ hoạt động trong secure context (HTTPS hoặc localhost).
Để dùng điện thoại, triển khai ứng dụng lên dịch vụ HTTPS như Render hoặc dùng tunnel HTTPS.
Không dùng Flask development server làm máy chủ production.

## Lưu ý học thuật
EasyOCR là baseline OCR đa ngôn ngữ; khả năng đọc chữ viết tay phụ thuộc dữ liệu, kiểu chữ và chất lượng ảnh. Cần tự xây dựng tập kiểm thử và đánh giá CER/WER; không lấy confidence làm độ chính xác thực tế.
