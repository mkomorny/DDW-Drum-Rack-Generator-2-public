const fs = require('node:fs');

// Duration/sampleRate/channels extraction WITHOUT decoding audio.
//
// Both WAV and AIFF store their data as a sequence of self-describing
// chunks: a 4-byte id, a 4-byte length, then that many bytes of payload.
// The chunk that actually holds the sample data (`data` in WAV, `SSND` in
// AIFF) can be huge — tens of MB — but its *chunk header* tells us its byte
// length without reading a single sample. Duration falls straight out of
// that length plus the format chunk's sample rate/channel count. So the
// only chunk whose payload we ever actually read is the small format chunk
// (`fmt `/`COMM`, ~16-20 bytes); every other chunk we skip over by seeking
// past its declared length. This keeps a "scan" to a handful of small reads
// per file regardless of the file's actual size.

const MAX_CHUNK_SCAN_BYTES = 16 * 1024 * 1024; // safety cap against corrupt/malformed files

function readChunkHeader(fd, offset, littleEndian) {
  const buf = Buffer.alloc(8);
  const n = fs.readSync(fd, buf, 0, 8, offset);
  if (n < 8) return null;
  const id = buf.toString('ascii', 0, 4);
  const size = littleEndian ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
  return { id, size };
}

function parseWav(fd) {
  const riff = Buffer.alloc(12);
  if (fs.readSync(fd, riff, 0, 12, 0) < 12) return null;
  if (riff.toString('ascii', 0, 4) !== 'RIFF' || riff.toString('ascii', 8, 12) !== 'WAVE') return null;

  let offset = 12;
  let channels = null, sampleRate = null, bitDepth = null, dataSize = null;

  while (offset < MAX_CHUNK_SCAN_BYTES) {
    const chunk = readChunkHeader(fd, offset, true);
    if (!chunk) break;
    const bodyOffset = offset + 8;

    if (chunk.id === 'fmt ') {
      const fmt = Buffer.alloc(Math.min(chunk.size, 16));
      fs.readSync(fd, fmt, 0, fmt.length, bodyOffset);
      if (fmt.length >= 16) {
        channels = fmt.readUInt16LE(2);
        sampleRate = fmt.readUInt32LE(4);
        bitDepth = fmt.readUInt16LE(14);
      }
    } else if (chunk.id === 'data') {
      dataSize = chunk.size;
      break; // never read the actual sample bytes
    }

    offset = bodyOffset + chunk.size + (chunk.size % 2); // chunks are word-aligned
    if (chunk.size === 0 && chunk.id !== 'data') break; // avoid stalling on a malformed 0-size chunk
  }

  if (sampleRate == null || channels == null || dataSize == null || bitDepth == null) return null;
  const blockAlign = channels * (bitDepth / 8);
  const durationMs = blockAlign > 0 ? (dataSize / blockAlign / sampleRate) * 1000 : null;
  return { durationMs, sampleRate, channels, bitDepth };
}

// AIFF stores sample rate as an 80-bit IEEE 754 extended-precision float
// (the SANE "extended" format) — not a plain integer like WAV. This decodes
// the 10-byte big-endian representation into a normal JS number.
function readExtendedBE(buf, offset) {
  const sign = (buf[offset] & 0x80) ? -1 : 1;
  const exponent = ((buf[offset] & 0x7f) << 8) | buf[offset + 1];
  const hi = buf.readUInt32BE(offset + 2);
  const lo = buf.readUInt32BE(offset + 6);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  if (exponent === 0x7fff) return sign * Infinity;
  const mantissa = hi * 4294967296 + lo; // hi * 2^32 + lo, as a 64-bit integer value
  return sign * mantissa * Math.pow(2, exponent - 16383 - 63);
}

function parseAiff(fd) {
  const form = Buffer.alloc(12);
  if (fs.readSync(fd, form, 0, 12, 0) < 12) return null;
  const formType = form.toString('ascii', 8, 12);
  if (form.toString('ascii', 0, 4) !== 'FORM' || (formType !== 'AIFF' && formType !== 'AIFC')) return null;

  let offset = 12;
  let channels = null, sampleRate = null, bitDepth = null, numFrames = null;

  while (offset < MAX_CHUNK_SCAN_BYTES) {
    const chunk = readChunkHeader(fd, offset, false);
    if (!chunk) break;
    const bodyOffset = offset + 8;

    if (chunk.id === 'COMM') {
      const comm = Buffer.alloc(Math.min(chunk.size, 18));
      fs.readSync(fd, comm, 0, comm.length, bodyOffset);
      if (comm.length >= 18) {
        channels = comm.readUInt16BE(0);
        numFrames = comm.readUInt32BE(2);
        bitDepth = comm.readUInt16BE(6);
        sampleRate = Math.round(readExtendedBE(comm, 8));
      }
      break; // COMM always precedes SSND per spec; nothing else needed
    }

    offset = bodyOffset + chunk.size + (chunk.size % 2);
    if (chunk.size === 0) break;
  }

  if (sampleRate == null || channels == null || numFrames == null || bitDepth == null || sampleRate === 0) return null;
  const durationMs = (numFrames / sampleRate) * 1000;
  return { durationMs, sampleRate, channels, bitDepth };
}

const PARSERS = {
  '.wav': parseWav,
  '.wave': parseWav,
  '.aif': parseAiff,
  '.aiff': parseAiff,
  '.aifc': parseAiff
};

function parseAudioHeader(filePath, ext) {
  const parser = PARSERS[ext.toLowerCase()];
  if (!parser) return null;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    return parser(fd);
  } catch {
    return null; // unreadable/corrupt/truncated file — skip, don't abort the scan
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { parseAudioHeader };
