/* ======================================================
   HANDWRITTEN OCR - APP.JS
   Bản hoàn chỉnh: OCR + Camera + QR iPhone + Mèo thám tử
   (Đã sửa: nút "Xem ảnh kích thước lớn" bị mờ / không bấm được)
====================================================== */

let stream = null;
let capturedDataUrl = null;
let lastResult = null;
let activeKeyword = "";
let selectedDetectionIds = new Set();

let ocrRequestId = 0;
let ocrAbortController = null;
let currentProcessingTime = 0;

let qrPollTimer = null;
let activeQrToken = null;
let qrChecking = false;
let qrImageReceived = false;

const $ = (id) => document.getElementById(id);

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
}

function setDisplay(id, value) {
    const el = $(id);
    if (el) el.style.display = value;
}

function toast(message) {
    const el = $("toast");

    if (!el) {
        console.log("[OCR]", message);
        return;
    }

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
        el.classList.remove("show");
    }, 2800);
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[ch]);
}

function getDetections() {
    return Array.isArray(lastResult?.detections)
        ? lastResult.detections
        : [];
}

function detectionId(item) {
    return String(item.id);
}


// ======================================================
//        [FIX] LUÔN BẬT NÚT XEM ẢNH KÍCH THƯỚC LỚN
// ======================================================

function enableZoomButton() {

    const btn = $("zoomImage");

    if (!btn) return;

    btn.disabled = false;
    btn.removeAttribute("disabled");
    btn.removeAttribute("aria-disabled");
    btn.classList.remove("disabled");

    btn.style.opacity = "1";
    btn.style.pointerEvents = "auto";
    btn.style.cursor = "pointer";
}


// ======================================================
//                 TẠO GIAO DIỆN BỔ SUNG
// ======================================================

function ensureExtraUI() {

    if (!$("previewInfo")) {
        const preview = document.querySelector(".preview-wrap");

        if (preview) {
            const info = document.createElement("div");

            info.id = "previewInfo";
            info.className = "ocr-preview-info";

            preview.insertAdjacentElement("afterend", info);
        }
    }

    if (!$("zoomImage")) {
        const preview = document.querySelector(".preview-wrap");

        if (preview) {
            const button = document.createElement("button");

            button.type = "button";
            button.id = "zoomImage";
            button.className = "btn outline";
            button.textContent = "⤢ Xem ảnh kích thước lớn";

            preview.insertAdjacentElement("afterend", button);
        }
    }

    const table = document.querySelector(
        ".table-container table"
    );

    if (table) {
        const headRow = table.querySelector("thead tr");

        if (
            headRow &&
            !headRow.querySelector(".select-column")
        ) {
            const th = document.createElement("th");

            th.className = "select-column";
            th.textContent = "Chọn";

            headRow.insertBefore(
                th,
                headRow.firstElementChild
            );
        }
    }

    const tableContainer = document.querySelector(
        ".table-container"
    );

    if (
        tableContainer &&
        !$("regionSelectionControls")
    ) {
        const controls = document.createElement("div");

        controls.id = "regionSelectionControls";
        controls.className = "ocr-selection-controls";

        controls.innerHTML = `
            <span>
                Vùng đã chọn:
                <b id="selectedCount">0</b>
            </span>

            <button type="button"
                    class="btn outline"
                    id="selectAll">
                Chọn tất cả
            </button>

            <button type="button"
                    class="btn outline"
                    id="deselectAll">
                Bỏ chọn
            </button>
        `;

        tableContainer.insertAdjacentElement(
            "beforebegin",
            controls
        );
    }

    if (!$("clearSearch") && $("searchKeyword")) {
        const button = document.createElement("button");

        button.type = "button";
        button.id = "clearSearch";
        button.className = "btn";
        button.textContent = "Xóa tìm kiếm";

        $("searchKeyword").insertAdjacentElement(
            "afterend",
            button
        );
    }

    if (!$("searchResult") && $("searchKeyword")) {
        const result = document.createElement("div");

        result.id = "searchResult";
        result.className = "search-summary";

        $("searchKeyword").parentElement
            ?.insertAdjacentElement("afterend", result);
    }


    // ==================================================
    //                 GIAO DIỆN MÈO THÁM TỬ
    // ==================================================

    if (!$("ocrMascot")) {
        const mascot = document.createElement("section");

        mascot.id = "ocrMascot";
        mascot.className = "ocr-mascot";

        mascot.innerHTML = `
            <div class="mascot-art">
                <img
                    id="ocrMascotImage"
                    src="/static/images/cat-detective-search.gif"
                    alt="Mèo thám tử OCR"
                >
            </div>

            <div class="mascot-copy">
                <strong id="ocrMascotTitle">
                    Mèo thám tử đã sẵn sàng
                </strong>

                <p id="ocrMascotText">
                    Chọn ảnh và bắt đầu nhận dạng
                    để mèo tìm chữ giúp bạn.
                </p>
            </div>
        `;

        const workspace = document.querySelector(
            ".workspace"
        );

        if (workspace) {
            workspace.insertAdjacentElement(
                "afterend",
                mascot
            );
        }
    }


    // ==================================================
    //                  MODAL XEM ẢNH
    // ==================================================

    if (!$("imageModal")) {
        const modal = document.createElement("div");

        modal.id = "imageModal";
        modal.className = "ocr-image-modal";

        modal.setAttribute("aria-hidden", "true");

        modal.innerHTML = `
            <div class="ocr-modal-dialog"
                 role="dialog"
                 aria-modal="true"
                 aria-label="Xem ảnh và vùng nhận dạng">

                <div class="ocr-modal-header">

                    <strong>
                        Xem ảnh và các vùng nhận dạng
                    </strong>

                    <span id="modalSelectedInfo">
                        0 vùng được chọn
                    </span>

                    <button type="button"
                            class="btn"
                            id="closeImageModal">
                        Đóng ✕
                    </button>

                </div>

                <div class="ocr-modal-canvas-wrap">
                    <canvas id="modalCanvas"></canvas>
                </div>

                <div class="ocr-modal-footer">

                    <button type="button"
                            class="btn outline"
                            id="modalSelectAll">
                        Chọn tất cả vùng
                    </button>

                    <button type="button"
                            class="btn outline"
                            id="modalDeselectAll">
                        Bỏ chọn tất cả
                    </button>

                    <button type="button"
                            class="btn primary"
                            id="closeModalBottom">
                        Hoàn tất
                    </button>

                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }


    // ==================================================
    //                    CSS BỔ SUNG
    // ==================================================

    if (!$("ocrExtraStyles")) {
        const style = document.createElement("style");

        style.id = "ocrExtraStyles";

        style.textContent = `

            .ocr-preview-info {
                font-size: 12px;
                color: #718096;
                margin-top: 7px;
            }

            /* [FIX] Nút xem ảnh lớn: luôn rõ nét, luôn bấm được */
            #zoomImage {
                opacity: 1 !important;
                pointer-events: auto !important;
                cursor: pointer !important;
                color: #315bd6 !important;
                border: 1px solid #315bd6 !important;
                background: #fff !important;
                font-weight: 600;
            }

            #zoomImage:hover {
                background: #f0f5ff !important;
            }

            #zoomImage:disabled {
                opacity: 1 !important;
                color: #315bd6 !important;
            }

            .ocr-selection-controls {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                margin: 12px 0;
            }

            .ocr-selection-controls span {
                font-size: 12px;
                color: #64748b;
                margin-right: auto;
            }

            .region-checkbox {
                width: 17px;
                height: 17px;
                cursor: pointer;
                accent-color: #315bd6;
            }

            .selected-row {
                background: #f0f5ff !important;
            }

            /* MODAL */

            .ocr-image-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 9999;
                background: rgba(8,17,35,.88);
                padding: 3vh 3vw;
            }

            .ocr-image-modal.open {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .ocr-modal-dialog {
                width: min(1200px,100%);
                height: 94vh;
                background: #fff;
                border-radius: 14px;
                padding: 14px;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            .ocr-modal-header,
            .ocr-modal-footer {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }

            .ocr-modal-header strong {
                margin-right: auto;
                color: #14233f;
            }

            .ocr-modal-header span {
                font-size: 12px;
                color: #64748b;
            }

            .ocr-modal-canvas-wrap {
                flex: 1;
                min-height: 0;
                overflow: auto;
                background: #101828;
                border-radius: 9px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            #modalCanvas {
                max-width: 100%;
                max-height: 100%;
                width: auto;
                height: auto;
                object-fit: contain;

                /* [FIX] Giảm hiện tượng ảnh bị mờ khi phóng to */
                image-rendering: -webkit-optimize-contrast;
                image-rendering: crisp-edges;
            }


            /* ==========================================
                       MÈO THÁM TỬ OCR
            ========================================== */

            .ocr-mascot {
                display: none;
                align-items: center;
                gap: 18px;
                background: #fff;
                border: 1px solid #e5eaf2;
                border-radius: 15px;
                padding: 18px 22px;
                margin: 0 0 18px;
                min-height: 112px;
                overflow: hidden;
            }

            .ocr-mascot.active {
                display: flex;
                animation: mascotAppear .35s ease;
            }

            .ocr-mascot .mascot-art {
                width: 100px;
                min-width: 100px;
                height: 100px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .ocr-mascot .mascot-art img {
                width: 100%;
                height: 100%;
                object-fit: contain;
            }

            .ocr-mascot strong {
                color: #14233f;
                font-size: 15px;
            }

            .ocr-mascot p {
                margin: 6px 0 0;
                color: #718096;
                font-size: 13px;
                line-height: 1.5;
            }

            .ocr-mascot.searching .mascot-art {
                animation: ocrCatSearch .65s ease-in-out infinite alternate;
            }

            .ocr-mascot.success .mascot-art {
                animation: ocrCatWin .6s ease-in-out 3;
            }

            @keyframes mascotAppear {
                from {
                    opacity: 0;
                    transform: translateY(8px);
                }

                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @keyframes ocrCatSearch {
                from {
                    transform: rotate(-8deg) translateY(2px);
                }

                to {
                    transform: rotate(8deg) translateY(-5px);
                }
            }

            @keyframes ocrCatWin {
                0%,100% {
                    transform: translateY(0) rotate(0);
                }

                50% {
                    transform: translateY(-12px) rotate(12deg);
                }
            }

            @media(max-width:600px) {

                .ocr-image-modal {
                    padding: 8px;
                }

                .ocr-modal-dialog {
                    height: 96vh;
                    padding: 9px;
                }

                .ocr-mascot {
                    padding: 13px;
                    gap: 12px;
                }

                .ocr-mascot .mascot-art {
                    width: 75px;
                    min-width: 75px;
                    height: 75px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    // [FIX] Luôn bật nút sau khi dựng giao diện.
    enableZoomButton();
}


// Tạo giao diện trước khi gắn sự kiện.
ensureExtraUI();


// ======================================================
//                    MÈO THÁM TỬ OCR
// ======================================================

function setMascotState(state) {

    const mascot = $("ocrMascot");
    const image = $("ocrMascotImage");
    const title = $("ocrMascotTitle");
    const description = $("ocrMascotText");

    if (!mascot || !image || !title || !description) {
        return;
    }

    mascot.classList.remove("searching", "success");

    if (state === "idle") {

        mascot.classList.add("active");

        image.src = "/static/images/cat-detective-search.gif";

        title.textContent = "Mèo thám tử OCR";

        description.textContent =
            "Sẵn sàng tìm kiếm chữ viết trong tài liệu.";

    } else if (state === "searching") {

        mascot.classList.add("active", "searching");

        image.src = "/static/images/cat-detective-search.gif";

        title.textContent = "Thám tử đang làm việc!";

        description.textContent =
            "Đang tìm kiếm và phân tích từng dòng chữ...";

    } else if (state === "success") {

        mascot.classList.add("active", "success");

        image.src = "/static/images/cat-detective-success.gif";

        title.textContent = "Hoàn thành nhiệm vụ!";

        description.textContent =
            "Mèo thám tử đã nhận dạng văn bản thành công!";
    }
}


// Ẩn mèo khi OCR thất bại.
function hideOCRMascot() {

    const mascot = $("ocrMascot");

    if (!mascot) return;

    mascot.classList.remove(
        "active",
        "searching",
        "success"
    );
}


// ======================================================
//                    HỦY OCR CŨ
// ======================================================

function cancelCurrentOCR() {

    ocrRequestId++;

    if (ocrAbortController) {
        ocrAbortController.abort();
        ocrAbortController = null;
    }

    const button = $("recognize");

    if (button) {
        button.disabled = false;
        button.textContent = "✦ Bắt đầu nhận dạng";
    }

    setDisplay("loading", "none");

    setMascotState("idle");
}


// ======================================================
//                    CAMERA MÁY TÍNH
// ======================================================

async function startCamera() {

    try {

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                "Trình duyệt không hỗ trợ camera hoặc trang chưa chạy HTTPS."
            );
        }

        stopCamera();

        const facingMode =
            $("cameraFacing")?.value || "environment";

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: facingMode },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        const video = $("video");

        if (!video) {
            throw new Error(
                "Không tìm thấy phần tử video trong HTML."
            );
        }

        video.srcObject = stream;

        setDisplay("cameraPlaceholder", "none");

        await video.play();

        toast("Camera đã được bật.");

    } catch (error) {

        console.error(error);

        toast(error.message || "Không mở được camera.");
    }
}


function stopCamera() {

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    stream = null;

    const video = $("video");

    if (video) {
        video.srcObject = null;
    }

    setDisplay("cameraPlaceholder", "flex");
}


function captureImage() {

    const video = $("video");

    if (!video || !video.videoWidth) {
        return toast("Hãy mở camera trước.");
    }

    const canvas = document.createElement("canvas");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
        return toast("Không thể xử lý khung hình camera.");
    }

    ctx.drawImage(video, 0, 0);

    setImage(canvas.toDataURL("image/jpeg", 0.92));

    toast("Đã chụp ảnh mới. Kết quả OCR cũ đã được làm mới.");
}


// ======================================================
//                    CHỌN / THAY ẢNH
// ======================================================

function setImage(dataUrl) {

    if (
        typeof dataUrl !== "string" ||
        !dataUrl.startsWith("data:image/")
    ) {
        toast("Dữ liệu ảnh không hợp lệ.");
        return;
    }

    // Hủy OCR cũ trước khi thay ảnh.
    cancelCurrentOCR();

    capturedDataUrl = dataUrl;

    // [FIX] Có ảnh mới thì bật nút xem ảnh lớn.
    enableZoomButton();

    lastResult = null;
    activeKeyword = "";
    selectedDetectionIds.clear();
    currentProcessingTime = 0;

    if ($("recognizedText")) {
        $("recognizedText").value = "";
    }

    if ($("keyword")) {
        $("keyword").value = "";
    }

    setDisplay("previewPlaceholder", "none");
    setDisplay("resultCanvas", "block");

    setText("previewInfo", "Đang tải ảnh...");
    setText("searchResult", "Chưa thực hiện tìm kiếm.");

    setText("regionCount", "0");
    setText("characterCount", "0");
    setText("wordCount", "0");
    setText("processingTime", "0s");
    setText("totalCount", "0");
    setText("selectedCount", "0");
    setText("matchCount", "0");
    setText("avgConfidence", "—");
    setText("imageSize", "—");

    if ($("detectionRows")) {
        $("detectionRows").innerHTML = `
            <tr>
                <td colspan="8" class="empty-cell">
                    Ảnh mới đã sẵn sàng.
                    Nhấn Bắt đầu nhận dạng.
                </td>
            </tr>
        `;
    }

    const image = new Image();

    image.onload = () => {

        if (dataUrl !== capturedDataUrl) return;

        setText(
            "previewInfo",
            `${image.naturalWidth} × ${image.naturalHeight} px`
        );

        setText(
            "imageSize",
            `${image.naturalWidth} × ${image.naturalHeight}`
        );

        drawCanvas();

        if ($("imageModal")?.classList.contains("open")) {
            drawCanvas("modalCanvas");
        }
    };

    image.onerror = () => {
        if (dataUrl === capturedDataUrl) {
            toast("Không thể hiển thị ảnh.");
        }
    };

    image.src = dataUrl;
}


// ======================================================
//                    TẢI ẢNH TỪ THIẾT BỊ
// ======================================================

if ($("fileInput")) {

    $("fileInput").addEventListener("change", event => {

        const file = event.target.files?.[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            toast("Vui lòng chọn tệp hình ảnh.");
            event.target.value = "";
            return;
        }

        if (file.size > 12 * 1024 * 1024) {
            toast("Ảnh tối đa 12 MB.");
            event.target.value = "";
            return;
        }

        const reader = new FileReader();

        reader.onload = () => {

            if (typeof reader.result === "string") {
                setImage(reader.result);
                toast("Đã tải ảnh mới lên.");
            } else {
                toast("Dữ liệu ảnh không hợp lệ.");
            }
        };

        reader.onerror = () => {
            toast("Không thể đọc tệp ảnh.");
        };

        reader.readAsDataURL(file);

        event.target.value = "";
    });
}


$("startCamera")?.addEventListener("click", startCamera);
$("stopCamera")?.addEventListener("click", stopCamera);
$("capture")?.addEventListener("click", captureImage);


// ======================================================
//                       NHẬN DẠNG OCR
// ======================================================

async function recognize() {

    if (!capturedDataUrl) {
        return toast("Hãy chụp ảnh hoặc tải ảnh lên trước.");
    }

    const imageSnapshot = capturedDataUrl;

    const requestId = ++ocrRequestId;

    if (ocrAbortController) {
        ocrAbortController.abort();
    }

    const controller = new AbortController();

    ocrAbortController = controller;

    const button = $("recognize");

    if (button) {
        button.disabled = true;
        button.textContent = "Đang nhận dạng...";
    }

    setDisplay("loading", "block");

    // Mèo xuất hiện khi bắt đầu OCR.
    setMascotState("searching");

    const startTime = performance.now();

    try {

        const response = await fetch("/api/recognize", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            signal: controller.signal,

            body: JSON.stringify({
                image: imageSnapshot,
                preprocess: $("preprocess")?.value || "none"
            })
        });

        let data;

        try {
            data = await response.json();
        } catch {
            throw new Error(
                "Máy chủ trả về dữ liệu không hợp lệ."
            );
        }

        // Không cho phép kết quả cũ ghi đè kết quả mới.
        if (
            requestId !== ocrRequestId ||
            imageSnapshot !== capturedDataUrl
        ) {
            return;
        }

        if (!response.ok || !data.success) {
            throw new Error(data.error || "OCR thất bại.");
        }

        currentProcessingTime =
            (performance.now() - startTime) / 1000;

        lastResult = data;

        activeKeyword = "";

        selectedDetectionIds = new Set(
            getDetections().map(detectionId)
        );

        if ($("recognizedText")) {
            $("recognizedText").value = data.full_text || "";
        }

        updateMetrics(data);

        renderTable();

        drawCanvas();

        // Nếu modal đang mở thì vẽ lại luôn.
        if ($("imageModal")?.classList.contains("open")) {
            drawCanvas("modalCanvas");
        }

        setText(
            "searchResult",
            `Đã phát hiện ${getDetections().length} vùng chữ.`
        );

        // Chuyển sang GIF thành công.
        setMascotState("success");

        toast("Nhận dạng hoàn tất.");

    } catch (error) {

        if (error.name === "AbortError") return;

        if (requestId !== ocrRequestId) return;

        console.error("OCR ERROR:", error);

        // Ẩn mèo khi OCR thất bại.
        hideOCRMascot();

        toast("Lỗi nhận dạng: " + error.message);

    } finally {

        if (requestId === ocrRequestId) {

            ocrAbortController = null;

            if (button) {
                button.disabled = false;
                button.textContent = "✦ Bắt đầu nhận dạng";
            }

            setDisplay("loading", "none");
        }
    }
}

$("recognize")?.addEventListener("click", recognize);


// ======================================================
//                       THỐNG KÊ
// ======================================================

function updateMetrics(data) {

    const detections = Array.isArray(data.detections)
        ? data.detections
        : [];

    const fullText = String(data.full_text || "");

    const chars = Array.from(fullText)
        .filter(ch => !/\s/.test(ch))
        .length;

    const words = fullText.trim()
        ? fullText.trim().split(/\s+/).length
        : 0;

    const average = detections.length
        ? detections.reduce(
            (sum, item) =>
                sum + Number(item.confidence || 0),
            0
        ) / detections.length
        : 0;

    setText("regionCount", detections.length);
    setText("characterCount", chars);
    setText("wordCount", words);

    setText(
        "processingTime",
        currentProcessingTime.toFixed(2) + "s"
    );

    setText("totalCount", detections.length);

    setText(
        "avgConfidence",
        detections.length
            ? average.toFixed(2) + "%"
            : "—"
    );

    setText(
        "imageSize",
        `${data.image_width || 0} × ${data.image_height || 0}`
    );

    updateSelectedCount();
}


// ======================================================
//                 QUẢN LÝ VÙNG NHẬN DẠNG
// ======================================================

function updateSelectedCount() {

    setText(
        "selectedCount",
        selectedDetectionIds.size
    );

    setText(
        "modalSelectedInfo",
        `${selectedDetectionIds.size} vùng được chọn`
    );
}


function redrawAll() {

    updateSelectedCount();
    renderTable();
    drawCanvas();

    if ($("imageModal")?.classList.contains("open")) {
        drawCanvas("modalCanvas");
    }
}


function toggleDetection(id, checked) {

    const key = String(id);

    if (checked) {
        selectedDetectionIds.add(key);
    } else {
        selectedDetectionIds.delete(key);
    }

    redrawAll();
}


function selectAllDetections() {

    selectedDetectionIds = new Set(
        getDetections().map(detectionId)
    );

    redrawAll();
}


function deselectAllDetections() {

    selectedDetectionIds.clear();

    redrawAll();
}


$("selectAll")?.addEventListener("click", selectAllDetections);
$("deselectAll")?.addEventListener("click", deselectAllDetections);
$("modalSelectAll")?.addEventListener("click", selectAllDetections);
$("modalDeselectAll")?.addEventListener("click", deselectAllDetections);


// ======================================================
//                    BẢNG CHI TIẾT OCR
// ======================================================

function renderTable() {

    const tbody = $("detectionRows");

    if (!tbody) return;

    const all = getDetections();

    const visible = activeKeyword
        ? all.filter(d =>
            String(d.text || "").toLocaleLowerCase("vi")
                .includes(activeKeyword.toLocaleLowerCase("vi"))
        )
        : all;

    if (!all.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-cell">
                    Chưa có dữ liệu nhận dạng.
                </td>
            </tr>
        `;

        updateSelectedCount();
        return;
    }

    if (!visible.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-cell">
                    Không tìm thấy vùng phù hợp.
                </td>
            </tr>
        `;

        updateSelectedCount();
        return;
    }

    tbody.innerHTML = visible.map(d => {

        const id = detectionId(d);
        const checked = selectedDetectionIds.has(id);

        return `
            <tr class="${checked ? "selected-row" : ""}">

                <td>
                    <input
                        type="checkbox"
                        class="region-checkbox"
                        data-region-id="${escapeHtml(id)}"
                        ${checked ? "checked" : ""}
                        aria-label="Chọn vùng ${escapeHtml(id)}"
                    >
                </td>

                <td>${escapeHtml(d.id)}</td>

                <td class="region-text">
                    ${escapeHtml(d.text)}
                </td>

                <td>${escapeHtml(d.x)}</td>
                <td>${escapeHtml(d.y)}</td>
                <td>${escapeHtml(d.width)}</td>
                <td>${escapeHtml(d.height)}</td>

                <td>
                    ${Number(d.confidence || 0).toFixed(2)}%
                </td>

            </tr>
        `;

    }).join("");

    updateSelectedCount();
}


$("detectionRows")?.addEventListener("change", event => {

    const checkbox = event.target.closest(".region-checkbox");

    if (!checkbox) return;

    toggleDetection(
        checkbox.dataset.regionId,
        checkbox.checked
    );
});


// ======================================================
//                 VẼ KHUNG VÙNG NHẬN DẠNG
// ======================================================

function drawCanvas(canvasId = "resultCanvas") {

    if (!capturedDataUrl) return;

    const canvas = $(canvasId);

    if (!canvas) return;

    const imageSnapshot = capturedDataUrl;
    const resultSnapshot = lastResult;

    const selectedSnapshot = new Set(selectedDetectionIds);
    const keywordSnapshot = activeKeyword;

    const img = new Image();

    img.onload = () => {

        if (imageSnapshot !== capturedDataUrl) return;

        const ctx = canvas.getContext("2d");

        if (!ctx) return;

        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        // [FIX] Vẽ ảnh với chất lượng nội suy cao nhất.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        if (!resultSnapshot?.detections) return;

        resultSnapshot.detections.forEach(d => {

            const id = String(d.id);

            if (!selectedSnapshot.has(id)) return;

            if (
                !Array.isArray(d.box) ||
                d.box.length < 4
            ) {
                return;
            }

            const matched = keywordSnapshot &&
                String(d.text || "")
                    .toLocaleLowerCase("vi")
                    .includes(keywordSnapshot.toLocaleLowerCase("vi"));

            const points = d.box;

            ctx.beginPath();

            ctx.moveTo(
                Number(points[0][0]),
                Number(points[0][1])
            );

            points.slice(1).forEach(point => {
                ctx.lineTo(
                    Number(point[0]),
                    Number(point[1])
                );
            });

            ctx.closePath();

            ctx.lineWidth = Math.max(
                3,
                img.naturalWidth / 500
            );

            ctx.strokeStyle = matched
                ? "#ef3038"
                : "#14a66b";

            ctx.stroke();

            const label = String(d.id);

            ctx.font =
                `bold ${Math.max(14, img.naturalWidth / 65)}px Arial`;

            const labelWidth =
                ctx.measureText(label).width + 12;

            const lx = Math.max(0, Number(d.x) || 0);

            const ly = Math.max(
                0,
                (Number(d.y) || 0) - 26
            );

            ctx.fillStyle = matched
                ? "#ef3038"
                : "#1768d2";

            ctx.fillRect(lx, ly, labelWidth, 24);

            ctx.fillStyle = "#fff";

            ctx.fillText(label, lx + 6, ly + 18);
        });
    };

    img.onerror = () => {
        console.error("Không thể tải ảnh để vẽ canvas.");
    };

    img.src = imageSnapshot;
}


// ======================================================
//                    PHÓNG TO ẢNH
// ======================================================

function openImageModal() {

    if (!capturedDataUrl) {
        return toast("Chưa có ảnh để xem. Hãy chụp hoặc tải ảnh lên trước.");
    }

    const modal = $("imageModal");

    if (!modal) return;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");

    document.body.style.overflow = "hidden";

    updateSelectedCount();

    requestAnimationFrame(() => {
        drawCanvas("modalCanvas");
    });
}


function closeImageModal() {

    const modal = $("imageModal");

    if (!modal) return;

    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");

    document.body.style.overflow = "";
}


$("zoomImage")?.addEventListener("click", openImageModal);
$("closeImageModal")?.addEventListener("click", closeImageModal);
$("closeModalBottom")?.addEventListener("click", closeImageModal);

$("imageModal")?.addEventListener("click", event => {

    if (event.target.id === "imageModal") {
        closeImageModal();
    }
});


document.addEventListener("keydown", event => {

    if (event.key === "Escape") {
        closeImageModal();
    }
});


// ======================================================
//                    TÌM KIẾM TỪ KHÓA
// ======================================================

function searchKeyword() {

    if (!lastResult) {
        return toast("Hãy nhận dạng ảnh trước.");
    }

    const keyword = $("keyword")?.value.trim() || "";

    if (!keyword) {

        activeKeyword = "";

        setText("matchCount", "0");
        setText("searchResult", "Đã xóa bộ lọc tìm kiếm.");

        renderTable();
        drawCanvas();

        if ($("imageModal")?.classList.contains("open")) {
            drawCanvas("modalCanvas");
        }

        return;
    }

    activeKeyword = keyword;

    const matches = getDetections().filter(d =>
        String(d.text || "")
            .toLocaleLowerCase("vi")
            .includes(keyword.toLocaleLowerCase("vi"))
    );

    setText("matchCount", matches.length);

    setText(
        "searchResult",
        matches.length
            ? `Tìm thấy ${matches.length} vùng chứa từ khóa "${keyword}". Vùng phù hợp được viền đỏ.`
            : `Không tìm thấy từ khóa "${keyword}".`
    );

    matches.forEach(d => {
        selectedDetectionIds.add(detectionId(d));
    });

    renderTable();
    drawCanvas();
    updateSelectedCount();

    if ($("imageModal")?.classList.contains("open")) {
        drawCanvas("modalCanvas");
    }
}


$("searchKeyword")?.addEventListener("click", searchKeyword);

$("keyword")?.addEventListener("keydown", event => {

    if (event.key === "Enter") {
        searchKeyword();
    }
});


$("clearSearch")?.addEventListener("click", () => {

    if ($("keyword")) {
        $("keyword").value = "";
    }

    activeKeyword = "";

    setText("matchCount", "0");
    setText("searchResult", "Đã xóa bộ lọc tìm kiếm.");

    renderTable();
    drawCanvas();

    if ($("imageModal")?.classList.contains("open")) {
        drawCanvas("modalCanvas");
    }
});


// ======================================================
//                    SAO CHÉP VĂN BẢN
// ======================================================

$("copyText")?.addEventListener("click", async () => {

    const text = $("recognizedText")?.value || "";

    if (!text) {
        return toast("Chưa có văn bản để sao chép.");
    }

    try {

        await navigator.clipboard.writeText(text);

        toast("Đã sao chép văn bản.");

    } catch {

        const input = $("recognizedText");

        if (input) {
            input.select();
            document.execCommand("copy");
            toast("Đã sao chép văn bản.");
        }
    }
});


// ======================================================
//                    XUẤT FILE TXT / JSON
// ======================================================

async function downloadExport(endpoint, payload) {

    const response = await fetch(endpoint, {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify(payload)
    });

    if (!response.ok) {

        let message = "Không thể xuất tệp.";

        try {
            const error = await response.json();
            message = error.error || message;
        } catch {}

        throw new Error(message);
    }

    const blob = await response.blob();

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download = endpoint.endsWith("/txt")
        ? "ket_qua_nhan_dang.txt"
        : "ket_qua_nhan_dang.json";

    document.body.appendChild(link);

    link.click();

    link.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}


// Tải TXT
$("downloadTxt")?.addEventListener("click", async () => {

    try {

        if (!lastResult) {
            return toast("Chưa có kết quả OCR.");
        }

        await downloadExport(
            "/api/export/txt",
            {
                text: $("recognizedText")?.value || ""
            }
        );

        toast("Đã xuất file TXT.");

    } catch (error) {
        toast(error.message);
    }
});


// Tải JSON
$("downloadJson")?.addEventListener("click", async () => {

    try {

        if (!lastResult) {
            return toast("Chưa có kết quả OCR.");
        }

        await downloadExport(
            "/api/export/json",
            lastResult
        );

        toast("Đã xuất file JSON.");

    } catch (error) {
        toast(error.message);
    }
});


// ======================================================
//                    KẾT NỐI CAMERA IPHONE
// ======================================================

async function createQR() {

    const button = $("createQR");
    const qrArea = $("qrArea");
    const qrImage = $("qrImage");
    const qrStatus = $("qrStatus");
    const mobileLink = $("mobileLink");

    if (
        !button ||
        !qrArea ||
        !qrImage ||
        !qrStatus ||
        !mobileLink
    ) {
        return toast("HTML chưa có đầy đủ khu vực QR.");
    }

    if (qrPollTimer) {
        clearInterval(qrPollTimer);
    }

    qrPollTimer = null;
    activeQrToken = null;
    qrChecking = false;
    qrImageReceived = false;

    button.disabled = true;
    button.textContent = "Đang tạo mã QR...";

    try {

        const response = await fetch("/api/qr-session", {
            method: "POST"
        });

        const data = await response.json();

        if (
            !response.ok ||
            !data.token ||
            !data.qr ||
            !data.mobile_url
        ) {
            throw new Error(
                data.error || "Không thể tạo mã QR."
            );
        }

        activeQrToken = data.token;

        qrImage.src = data.qr;

        mobileLink.href = data.mobile_url;

        mobileLink.textContent =
            "Mở camera trên điện thoại";

        qrArea.style.display = "block";

        qrStatus.textContent =
            "Đang chờ iPhone quét mã QR và gửi ảnh...";

        qrPollTimer = setInterval(
            checkQRStatus,
            2000
        );

        checkQRStatus();

    } catch (error) {

        console.error("CREATE QR:", error);

        qrStatus.textContent =
            "Lỗi: " + error.message;

        toast(error.message);

    } finally {

        button.disabled = false;
        button.textContent = "Tạo mã QR kết nối";
    }
}


// ======================================================
//                    NHẬN ẢNH TỪ IPHONE
// ======================================================

async function checkQRStatus() {

    if (
        !activeQrToken ||
        qrChecking ||
        qrImageReceived
    ) {
        return;
    }

    qrChecking = true;

    const tokenSnapshot = activeQrToken;

    try {

        const response = await fetch(
            `/api/qr-session/${encodeURIComponent(tokenSnapshot)}`
        );

        if (!response.ok) {
            throw new Error(
                "Phiên QR hết hạn hoặc không hợp lệ."
            );
        }

        const data = await response.json();

        if (tokenSnapshot !== activeQrToken) {
            return;
        }

        if (!data.uploaded) {
            return;
        }

        qrImageReceived = true;

        if (qrPollTimer) {
            clearInterval(qrPollTimer);
        }

        qrPollTimer = null;

        setText(
            "qrStatus",
            "Đã nhận ảnh từ iPhone. Đang tải ảnh..."
        );

        const imageResponse = await fetch(
            `/api/qr-image/${encodeURIComponent(tokenSnapshot)}`
        );

        if (!imageResponse.ok) {
            throw new Error(
                "Không thể lấy ảnh từ iPhone."
            );
        }

        const blob = await imageResponse.blob();

        if (!blob.size) {
            throw new Error("Ảnh nhận được đang trống.");
        }

        const dataUrl = await new Promise(
            (resolve, reject) => {

                const reader = new FileReader();

                reader.onload = () => {
                    resolve(reader.result);
                };

                reader.onerror = () => {
                    reject(
                        new Error("Không thể đọc ảnh từ iPhone.")
                    );
                };

                reader.readAsDataURL(blob);
            }
        );

        if (tokenSnapshot !== activeQrToken) {
            return;
        }

        if (
            typeof dataUrl !== "string" ||
            !dataUrl.startsWith("data:image/")
        ) {
            throw new Error(
                "Dữ liệu ảnh từ iPhone không hợp lệ."
            );
        }

        // Cập nhật ảnh và hủy OCR cũ.
        setImage(dataUrl);

        setText(
            "qrStatus",
            "Đã nhận ảnh. Đang tự động nhận dạng..."
        );

        // Tự động OCR ảnh iPhone.
        await recognize();

        if (tokenSnapshot === activeQrToken) {

            setText(
                "qrStatus",
                "Đã nhận ảnh từ iPhone và hoàn tất yêu cầu OCR."
            );
        }

        toast("Đã nhận ảnh từ iPhone.");

    } catch (error) {

        if (tokenSnapshot !== activeQrToken) {
            return;
        }

        console.error("QR RECEIVE:", error);

        setText(
            "qrStatus",
            "Lỗi: " + error.message
        );

        toast("Lỗi nhận ảnh QR: " + error.message);

        qrImageReceived = false;

        if (activeQrToken && !qrPollTimer) {

            qrPollTimer = setInterval(
                checkQRStatus,
                2000
            );
        }

    } finally {

        if (tokenSnapshot === activeQrToken) {
            qrChecking = false;
        }
    }
}


$("createQR")?.addEventListener("click", createQR);


// ======================================================
//                    KHỞI TẠO HỆ THỐNG
// ======================================================

ensureExtraUI();

// [FIX] Đảm bảo nút xem ảnh lớn luôn sáng và bấm được.
enableZoomButton();

setMascotState("idle");


// ======================================================
//                    DỌN DẸP KHI ĐÓNG TRANG
// ======================================================

window.addEventListener("beforeunload", () => {

    stopCamera();

    if (ocrAbortController) {
        ocrAbortController.abort();
    }

    if (qrPollTimer) {
        clearInterval(qrPollTimer);
    }
});