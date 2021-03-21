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

    static fromArray(array, size){
        const bf = new Bitfield(size);
        array.forEach(ele => {
            bf.set(ele-1);
        });
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

    count(){
        let ctr=0;
        for(var i=0;i<this.length;i++){
            if(this.get(i))ctr++;
        }
        return ctr;
    }
}

module.exports.writeBigUInt64BE = function writeBigUInt64BE(buf,val,offset=0){
    let p=BigInt(Math.pow(16,8));
    buf.writeUInt32BE(Math.floor(Number(val/p)),offset);
    buf.writeUInt32BE(Number(val%p), offset+4);
}


const exec = require('child_process').exec;
const http = require('http');

module.exports.launchUI = function(){

    http.createServer((req, resp) => {
        if(req.url === '/') {
            fs.readFile('./ui.html', (err, html) => {
                if(err) {
                    throw err;
                }
                resp.writeHead(200, {"Content-Type": "text/html"});
                resp.write(html);
                resp.end();
            })
        } else if(req.url === '/uiStyles.css') {
            fs.readFile('./uiStyles.css', (err, data) => {
                if(err) {
                    throw err;
                }
                resp.writeHead(200, {"Content-Type": "text/css"});
                resp.write(data);
                resp.end();
            })
        }
    }).listen(9495);

    exec(getStartCommand()+' '+'http://localhost:9495/');

}

module.exports.openFolder = function(path){
    path = path.replace('/','\\')
    exec(getStartCommand()+' '+path);
}

function getStartCommand() {
    switch (process.platform) { 
    case 'darwin' : return 'open';
    case 'win32' : return 'start';
    case 'win64' : return 'start';
    default : return 'xdg-open';
    }
}