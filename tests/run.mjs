// Lance tous les fichiers *.test.mjs du dossier.
// Lancer : npm test
import { readdirSync } from 'node:fs';

const files = readdirSync(new URL('.', import.meta.url))
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();
for (const f of files) {
  process.stdout.write(`${f} … `);
  await import(`./${f}`);
}
