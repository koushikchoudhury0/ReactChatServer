var mysql = require("mysql")
let pool = mysql.createPool({
    connectionLimit: 100,
    host: "localhost",
    user: "root",
    password: "ThisisallM!",
    database: "react_chat"
})

const connect = async() => {    
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                console.log(err)
                reject(err)
            }
            else {                
                resolve(connection)
            }
        })
    })
}

const queryAsync = (connection, query) => {
    return new Promise((resolve, reject) => {
        connection.query(query, (err, results, fields) => {
            if (err) reject(err)
            else resolve({results, fields})
        })
    })
}


module.exports.queryAsync = queryAsync
module.exports.connect = connect