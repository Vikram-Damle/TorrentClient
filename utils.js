const crypto = require('crypto');
const fs = require('fs');
const config = require('./config').config;
let id = null;

module.exports.generateId = () => {
    //refer to https://wiki.theory.org/index.php/BitTorrentSpecification#peer_id
    if (!id) {
        id = crypto.randomBytes(20);
        Buffer.from('-AT0001-').copy(id, 0);
    }
    return id;
};

module.exports.group=(iterable, groupSize) => {
    let groups = [];
    for (let i = 0; i < iterable.length; i += groupSize) {
      groups.push(iterable.slice(i, i + groupSize));
    }
    return groups;
}

module.exports.Bitfield = class Bitfield{
    constructor(size){
        this.buffer=Buffer.alloc(Math.ceil(size/8));
        this.length=size;
    }
    get(ind){
        if(ind>=this.length)
            throw new Error('Bitfield: Out of bounds!');
        let i=Math.floor(ind/8);
        let j=ind%8;
        let x=this.buffer[i];
        return ((x & (1<<(7-j))) != 0);
    }
    set(ind){
        if(ind>=this.length)
            throw new Error('Bitfield: Out of bounds!');
        let i=Math.floor(ind/8);
        let j=ind%8;
        let x=this.buffer[i];
        this.buffer[i] = x | (1<<(7-j));
    }
    unset(ind){
        if(ind>=this.length)
            throw new Error('Bitfield: Out of bounds!');
        let i=Math.floor(ind/8);
        let j=ind%8;
        let x=this.buffer[i];
        this.buffer[i] = x & ~(1<<(7-j));
    }
    static fromBuffer(buffer,size=buffer.length*8){
        const bf = new Bitfield(size);
        bf.buffer = buffer.slice(0,Math.ceil(size/8));
        return bf;
    }
    print(){
        for(var i=0;i<this.length;i++){
            if(this.get(i))
                process.stdout.write(i + " ");
            else
                process.stdout.write("- ");
        }
        console.log('');
    }
}

module.exports.writePiece=function(file,piece,offset){
    console.log(piece.length,offset,piece);
    fs.writeSync(file, piece, 0, piece.length, offset);   
    console.log('Piece written successfully!'); 
}

module.exports.openOverwrite=function(path){
    let oldData=fs.readFileSync(path);
    let fd=fs.openSync(path, 'w'); 
    fs.writeSync(fd,oldData);
    return fd;
}