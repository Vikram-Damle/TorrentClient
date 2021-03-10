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


const exec = require('child_process').exec;
const http = require('http');

module.exports.launchUI = function(){

    fs.readFile('./ui.html', function (err, html) {
        if (err) {
            throw err; 
        }       
        http.createServer(function(request, response) {  
            response.writeHeader(200, {"Content-Type": "text/html"});  
            response.write(html);  
            response.end();  
        }).listen(9495);
    });

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