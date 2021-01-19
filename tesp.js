const fs=require('fs');
const Buffer=require('buffer').Buffer;
const Bitfield = require('./utils').Bitfield;
let buff=fs.readFileSync('bitfield.bfd');
console.log(buff);
const bf=Bitfield.fromBuffer(buff);
bf.print();

