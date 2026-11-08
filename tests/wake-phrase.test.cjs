const { test } = require('node:test');
const assert = require('node:assert/strict');

test('finds "Hey Nova" and returns the command after it', async () => {
  const { extractWakeCommand } = await import('../ui/components/assistant/wake-phrase.mjs');
  assert.equal(extractWakeCommand('Hey Nova, can you check flights to SFO?'), 'can you check flights to SFO?');
  assert.equal(extractWakeCommand('hey nova open github'), 'open github');
  assert.equal(extractWakeCommand('Hey, Novah. What time is it?'), 'What time is it?');
  assert.equal(extractWakeCommand('Nova, reload'), 'reload');
  assert.equal(extractWakeCommand('Hi Nova!'), '');
  assert.equal(extractWakeCommand('Hey Nova.'), '');
  assert.equal(extractWakeCommand('So anyway, hey Nova was a good name'), null);
  assert.equal(extractWakeCommand('Hey Siri, play music'), null);
  assert.equal(extractWakeCommand('The Nova is bright'), null);
  assert.equal(extractWakeCommand('Hey Odyssey, reload'), null);
  assert.equal(extractWakeCommand(''), null);
});
