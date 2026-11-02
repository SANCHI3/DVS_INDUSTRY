/** A minimal JPEG header: SOI, APP0, SOF0 with the given size. */
export function fakeJpeg(width: number, height: number, padTo = 0): Buffer {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  ]);
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]);
  const body = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
  return padTo > body.length ? Buffer.concat([body, Buffer.alloc(padTo - body.length)]) : body;
}
