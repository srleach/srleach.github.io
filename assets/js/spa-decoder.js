// Browser decoder for the Jacuzzi/Sundance "encrypted" RS485 protocol.
// A port of the spa2mqtt protocol layer: https://github.com/srleach/spa2mqtt
(function (root) {
  'use strict';

  var FLAG = 0x7e;
  var MIN_LEN = 5;
  var MAX_LEN = 64;

  // CRC-8: poly 0x07, init 0x02, xorout 0x02, over LEN through the last payload byte.
  var CRC_TABLE = (function () {
    var table = [];
    for (var byte = 0; byte < 256; byte++) {
      var crc = byte;
      for (var i = 0; i < 8; i++) {
        crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
      }
      table.push(crc);
    }
    return table;
  })();

  function crc8(bytes) {
    var crc = 0x02;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[crc ^ bytes[i]];
    return crc ^ 0x02;
  }

  function parseHex(text) {
    var clean = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    var bytes = [];
    for (var i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.substr(i, 2), 16));
    return bytes;
  }

  function hex(bytes) {
    return bytes
      .map(function (b) {
        return (b < 16 ? '0' : '') + b.toString(16);
      })
      .join(' ');
  }

  // Frames are 7E | LEN | ADDR | MID | TYPE | payload | CRC | 7E. There is no byte stuffing, so
  // frame by LEN and accept only when the end flag and CRC both check out.
  function findFrames(bytes) {
    var frames = [];
    var i = 0;
    while (i + 1 < bytes.length) {
      if (bytes[i] !== FLAG) {
        i++;
        continue;
      }
      var len = bytes[i + 1];
      var end = i + len + 1;
      if (len < MIN_LEN || len > MAX_LEN || end >= bytes.length || bytes[end] !== FLAG) {
        i++;
        continue;
      }
      if (crc8(bytes.slice(i + 1, end - 1)) !== bytes[end - 1]) {
        i++;
        continue;
      }
      frames.push({
        addr: bytes[i + 2],
        mid: bytes[i + 3],
        type: bytes[i + 4],
        payload: bytes.slice(i + 5, end - 1),
        raw: bytes.slice(i, end + 1),
      });
      // Leave the closing flag in place: it may also be the next start flag.
      i = end;
    }
    return frames;
  }

  // S[i] = 0x19 ^ ((31 - i + adjust[i]) mod 64), adjust = -8 at bytes 5, 14, 15 and 22.
  var ADJUST = { 5: -8, 14: -8, 15: -8, 22: -8 };

  function keystream(length) {
    var s = [0];
    for (var i = 1; i < length; i++) {
      var n = (((31 - i + (ADJUST[i] || 0)) % 64) + 64) % 64;
      s.push(0x19 ^ n);
    }
    return s;
  }

  // plain[i] = payload[i] ^ payload[0] ^ S[i]; payload[0] is the per-frame key.
  function decrypt(payload) {
    var s = keystream(payload.length);
    return payload.map(function (b, i) {
      return b ^ payload[0] ^ s[i];
    });
  }

  // The older pairwise reading, still used for the lights frame.
  function fold(payload) {
    var out = [];
    for (var i = 0; i + 1 < payload.length; i += 2) out.push(payload[i] ^ payload[i + 1] ^ 1);
    return out;
  }

  function decodeStatus(payload) {
    var p = decrypt(payload);
    return {
      plain: p,
      hour: p[1],
      minute: p[22],
      dayOfWeek: p[5] & 0x07,
      day: p[14] >> 3,
      month: p[15] & 0x0f,
      year: 2000 + p[19],
      waterRaw: p[10],
      setpointRaw: p[16],
      heater: !!(p[21] & 0x40),
      pump1Running: !!(p[2] & 0x40),
      pump1Speed: (p[5] >> 3) & 0x03,
      pump2: !!(p[3] & 0x04),
      setMode: !!(p[5] & 0x20),
    };
  }

  function decodeButton(payload) {
    return payload.length < 2 ? null : payload[0] ^ payload[1] ^ 0xe0;
  }

  function decodeLights(payload) {
    var c = fold(payload);
    return { brightness: c[1], mode: c[4], red: c[8], green: c[6], blue: c[2] };
  }

  var api = {
    crc8: crc8,
    parseHex: parseHex,
    findFrames: findFrames,
    decrypt: decrypt,
    decodeStatus: decodeStatus,
    decodeButton: decodeButton,
    decodeLights: decodeLights,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  root.SpaDecoder = api;

  // --- Widget -----------------------------------------------------------------------------

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var SPEEDS = ['off', 'low', 'high'];
  var BUTTONS = { 0x00: 'none (idle)', 0x01: 'Temp up', 0x02: 'Temp down', 0x04: 'Pump 1', 0x05: 'Pump 2', 0x12: 'Light' };
  var LIGHT_MODES = {
    0x80: 'blend',
    0xff: 'transition',
    0x01: 'white',
    0x02: 'blue',
    0x03: 'green',
    0x06: 'red',
    0x07: 'violet',
    0x08: 'amber',
    0x09: 'aqua',
  };

  var SAMPLES = [
    {
      label: 'J235, May 2025',
      unit: 'C',
      hex: '7e26ffafc4f9f5fdfcf3f78e0af2f6b9f6cbea69eda3eeedf5e3e2c2e056e6e5a9ba9ad9d8dfb87e',
    },
    {
      label: 'J235, Nov 2026',
      unit: 'C',
      hex: '7e26ffafc40b190f0e0103b2f800044a0439183b11501c1f0411100c12a414178f7b682b2a2d497e',
    },
    {
      label: 'Sundance 780',
      unit: 'F',
      hex: '7e26ffafc4aea7aaaba4a1c95da5a1c2a19cbdcebbe2b9bbadb4b5a7b7dfb1b29bd38d8e8f88f97e',
    },
    {
      label: 'pyjacuzzi sample',
      unit: 'F',
      hex: '7e26ffafc4a2aba6a7a8ad0251abadc8ad90b122b6d3b5b7a0b8bc92bb14bdbedee681828384f07e',
    },
    {
      label: 'J235, heating',
      unit: 'C',
      hex: '7e26ffafc4637107666963da90686c236c517053793874776c7938537acc7c7fe72220434245ca7e',
    },
    {
      // Frames picked from the labelled capture; they were not adjacent on the wire.
      label: 'Mixed bus traffic',
      unit: 'C',
      hex:
        '7e0510bf065c7e 7e0710bfcc9f7bc47e ' +
        '7e22ffafcadd619df8936d91f49596956b8b8a89888f8e8d8c8382818087868584bb3e7e ' +
        '7e05febf00ac7e 7e0510bf065c7e 7e0710bfcc59b9177e ' +
        '7e26ffafc4c2d086c7c8da7b31c9cd83cdf0d1f2d899d5d6cdd8d9fbdb6dddde46b881e2e3e4677e',
    },
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function byteHex(b) {
    return '0x' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
  }

  function temperature(raw, unit) {
    return unit === 'C' ? (raw / 2).toFixed(1) + ' °C' : raw + ' °F';
  }

  function describe(frame, unit) {
    var rows = [];
    var title;
    if (frame.type === 0xc4) {
      var s = decodeStatus(frame.payload);
      title = 'Status (C4)';
      rows.push(['Key byte', byteHex(frame.payload[0])]);
      rows.push(['Tub clock', pad(s.hour) + ':' + pad(s.minute) + ', ' + (DAYS[s.dayOfWeek] || '?') + ' ' + s.day + '/' + pad(s.month) + '/' + s.year]);
      rows.push(['Water', temperature(s.waterRaw, unit)]);
      rows.push(['Setpoint', temperature(s.setpointRaw, unit)]);
      rows.push(['Heater', s.heater ? 'on' : 'off']);
      rows.push(['Pump 1', s.pump1Running ? 'running, speed ' + (SPEEDS[s.pump1Speed] || '?') : 'off']);
      rows.push(['Pump 2', s.pump2 ? 'on' : 'off']);
      rows.push(['Set mode', s.setMode ? 'active' : 'no']);
      rows.push(['Plaintext', hex(s.plain)]);
    } else if (frame.type === 0xcc) {
      var code = decodeButton(frame.payload);
      title = 'Button (CC) from channel ' + byteHex(frame.addr);
      rows.push(['Key byte', byteHex(frame.payload[0])]);
      rows.push(['Button', byteHex(code) + ' ' + (BUTTONS[code] || 'unknown')]);
    } else if (frame.type === 0xca) {
      var l = decodeLights(frame.payload);
      title = 'Lights (CA)';
      rows.push(['Brightness', String(l.brightness)]);
      rows.push(['Mode', byteHex(l.mode) + ' ' + (LIGHT_MODES[l.mode] || 'unknown')]);
      rows.push(['Red / green / blue', l.red + ' / ' + l.green + ' / ' + l.blue]);
    } else if (frame.type === 0x06) {
      title = 'Clear to send, channel ' + byteHex(frame.addr);
    } else if (frame.type === 0x00) {
      title = 'New-client poll';
    } else {
      title = 'Type ' + byteHex(frame.type) + ' (not decoded)';
      rows.push(['Payload', hex(frame.payload) || 'empty']);
    }
    return { title: title, rows: rows };
  }

  function mount(container) {
    var samples = el('div', 'decoder-samples');
    samples.appendChild(el('span', 'decoder-label', 'Samples:'));

    var input = el('textarea', 'decoder-input');
    input.rows = 4;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Hex bytes from the bus');
    input.placeholder = 'Paste hex bytes from the bus, e.g. 7e 26 ff af c4 ...';

    var unitLabel = el('label', 'decoder-unit', 'Temperature unit ');
    var unit = el('select');
    [['C', '°C (raw ÷ 2)'], ['F', '°F (raw)']].forEach(function (o) {
      var option = el('option', null, o[1]);
      option.value = o[0];
      unit.appendChild(option);
    });
    unitLabel.appendChild(unit);

    var output = el('div', 'decoder-output');
    output.setAttribute('aria-live', 'polite');

    function render() {
      output.textContent = '';
      var bytes = parseHex(input.value);
      if (!bytes.length) return;
      var frames = findFrames(bytes);
      if (!frames.length) {
        output.appendChild(el('p', 'decoder-empty', 'No valid frame found. A frame starts and ends with 7e and must pass its CRC.'));
        return;
      }
      frames.forEach(function (frame) {
        var info = describe(frame, unit.value);
        var card = el('div', 'decoder-frame');
        card.appendChild(el('p', 'decoder-frame-title', info.title));
        if (info.rows.length) {
          var list = el('dl');
          info.rows.forEach(function (row) {
            list.appendChild(el('dt', null, row[0]));
            list.appendChild(el('dd', null, row[1]));
          });
          card.appendChild(list);
        }
        output.appendChild(card);
      });
    }

    SAMPLES.forEach(function (sample) {
      var button = el('button', null, sample.label);
      button.type = 'button';
      button.addEventListener('click', function () {
        input.value = sample.hex;
        unit.value = sample.unit;
        render();
      });
      samples.appendChild(button);
    });

    input.addEventListener('input', render);
    unit.addEventListener('change', render);

    container.textContent = '';
    container.appendChild(samples);
    container.appendChild(input);
    container.appendChild(unitLabel);
    container.appendChild(output);

    input.value = SAMPLES[0].hex;
    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('spa-decoder');
    if (container) mount(container);
  });
})(this);
