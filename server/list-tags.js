/**
 * list-tags.js
 */

const { NFC } = require('nfc-pcsc');

const nfc = new NFC();

console.log('Waiting for a reader... plug in the ACR122U if you haven\'t.');

nfc.on('reader', (reader) => {
  console.log(`\nReader attached: ${reader.reader.name}`);
  console.log('Scan a tag now...\n');

  reader.on('card', (card) => {
    console.log(`UID: ${card.uid}   (type: ${card.type})`);
  });

  reader.on('error', (err) => console.error('Reader error:', err.message));
});

nfc.on('error', (err) => {
  console.error('NFC init error:', err.message);
  console.error('If this says "Card reader not found", check the driver install (see README).');
});
