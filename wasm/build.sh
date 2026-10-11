#!/bin/sh
# Builds wasm/dist/face_liveness_{simd,basic}.{js,wasm}. Needs an activated emsdk and the
# ncnn webassembly release (NCNN_WASM_DIR, downloaded automatically if unset).
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
NCNN_VERSION=20260526
NCNN_WASM_DIR="${NCNN_WASM_DIR:-$HERE/.ncnn/ncnn-$NCNN_VERSION-webassembly}"

if [ ! -d "$NCNN_WASM_DIR" ]; then
    mkdir -p "$HERE/.ncnn"
    curl -fL -o "$HERE/.ncnn/ncnn.zip" "https://github.com/Tencent/ncnn/releases/download/$NCNN_VERSION/ncnn-$NCNN_VERSION-webassembly.zip"
    (cd "$HERE/.ncnn" && unzip -q ncnn.zip && rm ncnn.zip)
fi

mkdir -p "$HERE/dist"
for variant in simd basic; do
    emcmake cmake -S "$HERE" -B "$HERE/.build/$variant" -DCMAKE_BUILD_TYPE=Release \
        -DNCNN_VARIANT=$variant -DNCNN_WASM_DIR="$NCNN_WASM_DIR" >/dev/null
    cmake --build "$HERE/.build/$variant" -j8
    cp "$HERE/.build/$variant/face_liveness_$variant.js" "$HERE/.build/$variant/face_liveness_$variant.wasm" "$HERE/dist/"
done
ls -la "$HERE/dist"
