var express = require("express")
var server = express()
var bodyParser = require("body-parser")
//var mysql = require("mysql")
//var jwt = require("jsonwebtoken")
var nano = require("nano-time")
var instance = require("./app_modules/Singleton.js").instance
var db = require("./app_modules/db.js")
var route = require("./app_modules/route.js")


server.use(bodyParser.json())
server.use(bodyParser.urlencoded({extended: true}));

//const jwtSecret = "example"

//let connectionMap = {}

/* let pool = mysql.createPool({
    connectionLimit: 100,
    host: "localhost",
    user: "root",
    password: "ThisisallM!",
    database: "react_chat"
})

const poolConnectionPromise = () => {    
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                console.log(err)
                reject(err)
            }
            else {
                //console.log("Resolving connection");
                resolve(connection)
            }
        })
    })
}

const db.queryAsync = (connection, query) => {
    return new Promise((resolve, reject) => {
        connection.query(query, (err, results, fields) => {
            if (err) reject(err)
            else resolve({results, fields})
        })
    })
} */

server.all('/*', function(req, res, next) {
    route.preflight(req, res, next)
});

server.get("/", (req, res) => {
	res.send("Server Accessible")
})

server.post("/register", async (req, res) => {  
    route.registration(db, req, res)
})

server.post("/login", async(req, res) => { 
    route.login(db, req, res)
    console.log(instance.userConnections)    
})

var x = server.listen(3001, () => {
    console.log("Server Listening at PORT 3001...")
})

var sio = require('socket.io').listen(x);

var getTableName = (uid1, uid2) => {
    return "msg"+(uid1>uid2?(`_${uid2}_${uid1}`):(`_${uid1}_${uid2}`))
}

sio.on("connection", (socket) => {
    console.log("New client connected: ", socket.id)    
    //console.log("Sockets: ", sio.sockets.sockets)  
    
    socket.emit("start-establish")

    socket.on("establish", async(req, res) => {

        console.log("Establishing New User")

        sio.sockets.sockets[socket.id].uid = req.uid

        //Register Database Connnection for user
        let connection = await db.connect()
        //connectionMap[req.uid] = connection
        instance.userConnections[req.uid] = connection        

        //Map User:Socket
        if (sio.users === undefined) sio.users = {}
        if (sio.users[req.uid] === undefined) sio.users[req.uid] = []
        if (sio.users[req.uid]!==undefined && sio.users[req.uid].length>0)
            sio.sockets.sockets[sio.users[req.uid]].emit("force-disconnect") /*Allow Single Connection*/
        sio.users[req.uid] = [socket.id]

        //Map Socket:User
        if (sio.socketMap === undefined) sio.socketMap = {}        
        sio.socketMap[socket.id] = req.uid
        
        console.log("User maps: ", sio.users)
        console.log("Socket maps: ", sio.socketMap)
        //console.log("Connection map: ", instance.userConnections)

        console.log("User established")

        res(true)
    })    
    
    socket.on("get-all-chats", async(req, res) => {
        //console.log("Pushing all chats")
        try {
            let connection = instance.userConnections[req.uid]            
            let table = `chat_${req.uid}`
            let chatResult = await db.queryAsync(connection, `SELECT ${table}.*, user.name FROM ${table} INNER JOIN user ON user.id=${table}.uid`)            
            res(chatResult.results)
        } catch(err) {
            res(undefined)
            console.log(err)
        }
    })

    socket.on("get-all-friend-requests", async(req, res) => {
        try {
            let connection = instance.userConnections[req.uid]                   
            let queryResult = await db.queryAsync(connection, `SELECT friend_request.id as id, friend_request.moment as moment, user.name as name FROM friend_request INNER JOIN user ON friend_request.src=user.id WHERE dest=${req.uid} AND accepted=0`)            
            res(queryResult.results)            
        } catch(err) {
            res(undefined)
            console.log(err)            
        }        
    })

    socket.on("publish-friend-request", async(req, res) => {
        console.log("Time to deliver new friend request", req)        
        let receiverIdResult, receiverId
        let connection = instance.userConnections[req.sender]
        try {            
            receiverIdResult = await db.queryAsync(connection, `SELECT id FROM user WHERE username='${req.receiver}'`)
            if (receiverIdResult.results.length === 0) {
                res({statusCode: 0, msg: "No such user"})                            
                return
            }
            receiverId = receiverIdResult.results[0].id             
        } catch(err) {
            console.log(err)
            res({statusCode: 0, msg: "Something went wrong"})                        
            return
        }
        try{
            let moment = new Date().getTime(), reqId = nano()            
            await db.queryAsync(connection, `INSERT INTO friend_request VALUES ('${reqId}', ${req.sender}, ${receiverId}, '${moment}', 0)`)
            console.log("Finding sockets of uid: ", receiverId)
            if (sio.users[receiverId] !== undefined){
                let userResult = await db.queryAsync(connection, `SELECT name FROM user WHERE id='${req.sender}'`)
                if (sio.users[receiverId]!==undefined && sio.users[receiverId].length>0)
                    sio.sockets.sockets[sio.users[receiverId]].emit("new-friend-request", {id: reqId, moment: moment, name: userResult.results[0].name})            
            }                        
        } catch(err) {
            console.log(err)
            res({statusCode: 0, msg: "You've already requested this person"})            
            return
        }         
        res({statusCode: 1})        
    })

    socket.on("accept-friend-request", async(req, res) => {
        try{
            console.log("Accepting Friend Request: ", req.reqId)
            let connection = instance.userConnections[req.uid]                    
            let table = "", src = "", dest = "";
            let qRes = await db.queryAsync(connection, `SELECT src,dest FROM friend_request WHERE id='${req.reqId}' AND accepted=0`)
            if (qRes.results.length == 1){
                src = qRes.results[0].src
                dest = qRes.results[0].dest
                table = "msg"+(src>dest?(`_${dest}_${src}`):(`_${src}_${dest}`))
                console.log("Table name: ", table)
            }
            console.log("Src: ", src, "Dest: ", dest)
            await db.queryAsync(connection, `UPDATE friend_request SET accepted=1 WHERE id='${req.reqId}'`)
            await db.queryAsync(connection, `CREATE TABLE IF NOT EXISTS ${table}(msgId VARCHAR(50) PRIMARY KEY, content VARCHAR(1000), sender INT(11))`)
            console.log("Inserting into src's chat")
            await db.queryAsync(connection, `INSERT INTO chat_${src} VALUES (${dest}, NULL, NULL, NULL, 0)`)
            console.log("Inserting into dest's chat")
            await db.queryAsync(connection, `INSERT INTO chat_${dest} VALUES (${src}, NULL, NULL, NULL, 0)`)            
            let chatForSrcResult = await db.queryAsync(connection, 
                `SELECT 
                    chat_${src}.*, user.name 
                FROM 
                    chat_${src} INNER JOIN user 
                ON 
                    user.id=chat_${src}.uid 
                WHERE 
                    chat_${src}.uid=${dest}`)
            console.log("ChatForSRC: ", chatForSrcResult.results[0])
            if (sio.users[src] !== undefined && sio.users[src].length>0) {
                console.log("Socket of src: ", sio.users[src]) 
                sio.sockets.sockets[sio.users[src]].emit("new-chat", chatForSrcResult.results[0])
            }
            let chatForDestResult = await db.queryAsync(connection, 
                `SELECT 
                    chat_${dest}.*, user.name 
                FROM 
                    chat_${dest} INNER JOIN user 
                ON 
                    user.id=chat_${dest}.uid 
                WHERE 
                    chat_${dest}.uid=${src}`)
            console.log("ChatForDEST: ", chatForDestResult.results[0])
            if (sio.users[dest] !== undefined && sio.users[dest].length>0) {
                console.log("Socket of dest: ", sio.users[dest]) 
                sio.sockets.sockets[sio.users[dest]].emit("new-chat", chatForDestResult.results[0])
            }
            res({statusCode: 1})
        } catch(err) {            
            console.log(err)
            res({statusCode: 0})            
        }
    })

    socket.on("load-conversation", async(req, res) => {
        let connection = instance.userConnections[req.uid]                    
        try{
            let convoRes = await db.queryAsync(connection, `SELECT * FROM ${getTableName(req.uid, req.targetUid)}`)
            await db.queryAsync(connection, `UPDATE chat_${req.uid} SET unread=0 WHERE uid='${req.targetUid}'`)
            res({statusCode: 1, conversation: convoRes.results})
        } catch(err) {
            console.log(err)
            res({statusCode: 0})
        }        
    })

    socket.on("send-msg", async(req, res) => {
        let connection = instance.userConnections[req.uid]                    
        try{
            let msg = {
                id: nano(),
                content: req.content,
                sender: req.uid,
                to: req.to,
                moment:  new Date().getTime()              
            }
            await db.queryAsync(connection, `INSERT INTO ${getTableName(req.uid, req.to)} VALUES('${msg.id}', '${msg.content}', ${msg.sender})`)
            await db.queryAsync(connection, `INSERT INTO chat_${req.uid} VALUES('${req.to}', '${msg.content}', ${msg.moment}, 1, 0) ON DUPLICATE KEY UPDATE moment=${msg.moment}, lastMsg='${msg.content}', sender=1`)
            await db.queryAsync(connection, `INSERT INTO chat_${req.to} VALUES('${req.uid}', '${msg.content}', ${msg.moment}, 0, 0) ON DUPLICATE KEY UPDATE moment=${msg.moment}, lastMsg='${msg.content}', sender=0, unread=unread+1`)
            if (sio.users[req.uid] !== undefined && sio.users[req.uid].length>0)
                sio.sockets.sockets[sio.users[req.uid]].emit("new-msg", {msg});
            if (sio.users[req.to] !== undefined && sio.users[req.to].length>0)
                sio.sockets.sockets[sio.users[req.to]].emit("new-msg", {msg});
            res({statusCode: 1, msg: msg})
        } catch(err) {
            console.log(err)
            res({statusCode: 0})
        }        
    })

    socket.on("read-chat", async(req) => {
        console.log(`Marking chat of user: ${req.src} as seen by ${req.uid}`)
        let connection = instance.userConnections[req.uid]
        await db.queryAsync(connection, `UPDATE chat_${req.uid} SET unread=0 WHERE uid='${req.src}'`)
    })

    socket.on("disconnect", () => {                
        if (sio.socketMap === undefined || sio.users === undefined) return
        targetUid = sio.socketMap[socket.id]        
        try { 
            instance.userConnections[targetUid].release()
            delete instance.userConnections[targetUid]
            console.log("User Connection Destroyed")
        } catch(err) { console.log(err) }
        console.log("Disconnected: ", socket.id, "belong to: ", targetUid)
        delete sio.socketMap[socket.id]
        if (sio.users[targetUid] === undefined) return
        sio.users[targetUid] = sio.users[targetUid].filter(e => e !== socket.id)
        console.log("User maps: ", sio.users)
        console.log("Socket maps: ", sio.socketMap)
    })
    
})

