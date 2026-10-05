'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/codec.js');
const { payloadValido } = require('./helpers/fixtures.js');

test('prefixo DISC1.', () => {
  assert.equal(C.PREFIXO, 'DISC1.');
  const s = C.encode({ a: 1 });
  assert.ok(s.startsWith('DISC1.'));
  assert.match(s.slice(6), /^[A-Za-z0-9_-]+$/, 'base64url sem + / =');
});

test('round-trip com acentos, emoji e caracteres especiais', () => {
  const p = payloadValido({ nome: 'Ângela Conceição D\'Ávila Ñuñez 😀', vaga: 'Coordenação & "Gestão" <TI>' });
  const s = C.encode(p);
  assert.deepEqual(C.decode(s), p);
});

test('round-trip de vários tamanhos (padding base64)', () => {
  for (let n = 0; n < 12; n++) {
    const obj = { t: 'ç'.repeat(n) + 'x'.repeat(n) };
    assert.deepEqual(C.decode(C.encode(obj)), obj);
  }
});

test('decode ignora espaços, quebras de linha e texto ao redor', () => {
  const p = payloadValido();
  const s = C.encode(p);
  const quebrado = s.slice(0, 20) + '\n  ' + s.slice(20, 50) + ' \r\n' + s.slice(50);
  assert.deepEqual(C.decode(quebrado), p);
  assert.deepEqual(C.decode('Código: ' + s), p);
});

test('decode aceita base64 padrão (+ / =)', () => {
  const obj = { nome: 'José ??>>' };
  const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  assert.deepEqual(C.decode('DISC1.' + b64), obj);
});

test('lixo gera erro em português', () => {
  assert.throws(() => C.decode(''), /DISC1\./);
  assert.throws(() => C.decode('abc'), /deve começar/);
  assert.throws(() => C.decode('DISC1.'), /vazio/);
  assert.throws(() => C.decode('DISC1.@@@###'), /inválido/);
  assert.throws(() => C.decode('DISC1.aGVsbG8'), /corrompido|inválido/); // "hello" não é JSON
  assert.throws(() => C.decode('DISC1.' + 'A'), /inválido/);
  assert.throws(() => C.decode(null), Error);
});

test('código truncado gera erro', () => {
  const s = C.encode(payloadValido());
  assert.throws(() => C.decode(s.slice(0, s.length - 15)), Error);
});
