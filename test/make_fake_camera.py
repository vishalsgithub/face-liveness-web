"""Creates face.y4m (a fake webcam stream) from a face photo for browser-test.mjs.

    python3 make_fake_camera.py ../demo/public/sample-face.jpg
"""
import sys

from PIL import Image

photo = Image.open(sys.argv[1] if len(sys.argv) > 1 else "../demo/public/sample-face.jpg").convert("RGB")
# 4:3 crop around the upper-middle of the photo, no padding (borders look like a held-up photo).
h = int(photo.width * 3 / 4)
top = max(0, min(photo.height - h, int(photo.height * 0.44) - h // 2))
frame = photo.crop((0, top, photo.width, top + h)).resize((640, 480), Image.LANCZOS)
frame.save("face_frame.png")

y, cb, cr = frame.convert("YCbCr").split()
data = y.tobytes() + cb.resize((320, 240)).tobytes() + cr.resize((320, 240)).tobytes()
with open("face.y4m", "wb") as f:
    f.write(b"YUV4MPEG2 W640 H480 F30:1 Ip A1:1 C420jpeg\n")
    for _ in range(30):
        f.write(b"FRAME\n" + data)
print("wrote face.y4m and face_frame.png")
