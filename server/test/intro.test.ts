import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The opening film is drawn live in 3D (intro3d.js) in the colours of the look that is on, with the flat intro (intro.js) as the fallback.
const pub = (f: string) => readFileSync(join(import.meta.dirname, '../../web/public', f), 'utf8');

test('the website loads the 3D opening film after the scene it shares its ball with, and keeps the flat intro', () => {
  const html = pub('index.html');
  assert.ok(html.indexOf('src="scene3d.js"') < html.indexOf('src="intro3d.js"'), 'scene3d.js comes first');
  assert.match(html, /<script src="intro\.js"><\/script>/);
});

test('the film follows the look, and falls back to the flat intro when 3D cannot play', () => {
  const app = pub('app.js'), film = pub('intro3d.js');
  assert.match(app, /window\.DajiIntro3D\.play\(box, window\.dajiIntroLook\(\), \{ onDone: end \}\)/);
  assert.match(app, /if \(!ok\) flat\(\);/);
  for (const f of ['diwali', 'navratri', 'ganesh', 'christmas', 'holi', 'tiranga', 'uttarayan']) assert.match(film, new RegExp(`\\b${f}: \\{ colours:`), f);
  assert.match(film, /d3I-skip/, 'the film has a Skip button');
});

test('the page shares one copy of three.js between the scene and the film', () => {
  assert.match(pub('scene3d.js'), /window\.DajiThreeLoading \|\| \(window\.DajiThreeLoading =/);
  assert.match(pub('intro3d.js'), /if \(!window\.DajiThreeLoading\) window\.DajiThreeLoading =/);
});
