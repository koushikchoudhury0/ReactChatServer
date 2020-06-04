const instance = require("./Singleton.js").instance
const jwt = require("jsonwebtoken")
const jwtSecret = "example"
module.exports = {
    
    preflight: (req, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "X-Requested-With");
        res.header("Access-Control-Allow-Headers", "Content-Type");
        res.header("Access-Control-Allow-Credentials", "true");
        next();
    },

    registration: async(db, req, res) => {
        resBody = {statusCode: 0}  
        try {             
            let connection = await db.connect()        
            let queryResult  = await db.queryAsync(connection, `INSERT INTO user(name, username, password) VALUES('${req.body.name}', '${req.body.username}', '${req.body.password}')`)
            await db.queryAsync(connection, `CREATE TABLE chat_${queryResult.results.insertId} (uid INT(11) PRIMARY KEY, lastMsg VARCHAR(1000), moment VARCHAR(15), sender INT(1), unread INT(11) NOT NULL DEFAULT 0)`)
            connection.release()        
            resBody.statusCode = 1
            resBody.data = queryResult.results.insertId
            res.send(resBody)
        } catch(err) {
            console.log(err)
            res.send(resBody)
        }
    },

    login: async(db, req, res) => {
        resBody = {statusCode: 0}
        try {
            let connection = await db.connect()        
            let queryResult  = await db.queryAsync(connection, `SELECT * FROM user WHERE username='${req.body.username}' AND password='${req.body.password}'`)                        
            if (queryResult.results.length == 1){
                //form token
                resBody.token = jwt.sign({
                    userId: queryResult.results[0].id
                }, jwtSecret, {
                    algorithm: 'HS512', 
                    expiresIn: '30d'
                })
                resBody.username = queryResult.results[0].username
                resBody.name = queryResult.results[0].name
                resBody.id = queryResult.results[0].id
                instance.userConnections[queryResult.results[0].id] = connection
                resBody.statusCode = 1
            } else {
                resBody.msg = "Incorrect Username or Password"
                connection.release()
            }        
            res.send(resBody)
        } catch(err) {
            console.log(err)
            res.send(resBody)
        }
    }

}