#!/usr/bin/env sh
# Build COLD FRONT — inlines every src/js module into the single-file index.html.
set -e
cd "$(dirname "$0")"
mkdir -p .build
cat src/js/*.js > .build/game.js
python3 - <<'PY'
shell = open('src/shell.html', encoding='utf-8').read()
js = open('.build/game.js', encoding='utf-8').read()
marker = '/*__GAME_JS__*/'
assert marker in shell, 'missing JS placeholder in shell.html'
out = shell.replace(marker, js)
open('index.html', 'w', encoding='utf-8', newline='\n').write(out)
print('built index.html  %d KB  (%d lines)' % (len(out) // 1024, out.count('\n') + 1))
PY
node --check .build/game.js && echo "syntax OK"
