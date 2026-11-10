import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFileName, validateUploadName, matchKey, splitExtension } from '../src/lib/filename.ts';
import { parseRange } from '../src/lib/range.ts';
import { parseImportText, parseCsv } from '../src/lib/playlistImport.ts';

test('parseFileName: пример из ТЗ', () => {
  assert.deepEqual(parseFileName('Logic - 44 bars.mp3'), { artist: 'Logic', title: '44 bars' });
});

test('parseFileName: делит по первому « - », дефисы в названии сохраняются', () => {
  assert.deepEqual(parseFileName('Jay-Z - Song - Part 2.flac'), { artist: 'Jay-Z', title: 'Song - Part 2' });
});

test('parseFileName: точки в названии, расширение в любом регистре', () => {
  assert.deepEqual(parseFileName('Artist - Song feat. X.WAV'), { artist: 'Artist', title: 'Song feat. X' });
});

test('parseFileName: кириллица и лишние пробелы', () => {
  assert.deepEqual(parseFileName('  Земфира   -   Хочешь?.mp3'), { artist: 'Земфира', title: 'Хочешь?' });
});

test('parseFileName: нарушение формата → null', () => {
  assert.equal(parseFileName('just a title.mp3'), null);
  assert.equal(parseFileName('Logic-44 bars.mp3'), null);
  assert.equal(parseFileName(' - Title.mp3'), null);
  assert.equal(parseFileName('Artist - .mp3'), null);
});

test('validateUploadName: формат и расширение', () => {
  assert.equal(validateUploadName('Logic - 44 bars.mp3').ok, true);
  assert.equal(validateUploadName('Logic - 44 bars.txt').ok, false);
  const bad = validateUploadName('noformat.mp3');
  assert.equal(bad.ok, false);
});

test('splitExtension', () => {
  assert.deepEqual(splitExtension('a.b.MP3'), { base: 'a.b', ext: '.mp3' });
  assert.deepEqual(splitExtension('noext'), { base: 'noext', ext: '' });
});

test('matchKey: сопоставляет варианты написания', () => {
  assert.equal(matchKey('Logic', '44 Bars'), matchKey('logic', '44 bars (Remastered)'));
  assert.equal(matchKey('Drake feat. Rihanna', 'Take Care'), matchKey('Drake', 'Take Care - Radio Edit'));
  assert.notEqual(matchKey('Logic', '44 Bars'), matchKey('Logic', '45 Bars'));
});

test('parseRange: основные случаи', () => {
  assert.equal(parseRange(undefined, 1000), null);
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=0-1,5-6', 1000), { start: 0, end: 1 });
});

test('parseRange: за пределами файла и мусор', () => {
  assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=50-10', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1', 0), 'unsatisfiable');
  assert.equal(parseRange('items=0-1', 1000), null);
  assert.equal(parseRange('bytes=-', 1000), null);
});

test('импорт: CSV из Exportify (кавычки, запятые, несколько исполнителей)', () => {
  const csv = [
    '\uFEFF"Track URI","Track Name","Album Name","Artist Name(s)","Release Date"',
    '"spotify:track:1","44 Bars","Everybody","Logic","2017-05-05"',
    '"spotify:track:2","Hello, World ""Live""","X","Artist One;Artist Two","2020-01-01"',
    '"spotify:track:3","44 Bars","Everybody","Logic","2017-05-05"',
  ].join('\r\n');
  assert.deepEqual(parseImportText(csv), [
    { artist: 'Logic', title: '44 Bars' },
    { artist: 'Artist One', title: 'Hello, World "Live"' },
  ]);
});

test('импорт: строки «Исполнитель - Название», нумерация, расширения, комментарии', () => {
  const text = '# мой список\n1. Logic - 44 Bars.mp3\n2) Jay-Z - Song - Part 2\n\nпросто текст без разделителя\n- Земфира — Хочешь?';
  assert.deepEqual(parseImportText(text), [
    { artist: 'Logic', title: '44 Bars' },
    { artist: 'Jay-Z', title: 'Song - Part 2' },
    { artist: 'Земфира', title: 'Хочешь?' },
  ]);
});

test('импорт: CSV с разделителем «;» и пустой ввод', () => {
  assert.deepEqual(parseImportText('artist;title\nA;B'), [{ artist: 'A', title: 'B' }]);
  assert.deepEqual(parseImportText(''), []);
  assert.deepEqual(parseCsv('a,b\n"x\ny",z'), [['a', 'b'], ['x\ny', 'z']]);
});
