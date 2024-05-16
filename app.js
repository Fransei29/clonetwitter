const express = require("express")
const app = express()
const path = require("path")
const bcrypt = require('bcrypt')
const redis = require('redis')
const session = require('express-session');
const RedisStore = require("connect-redis").default

// Conección a Redis 
const redisClient = redis.createClient({
  host: 'redis', // Replace 'docker_container_ip' with the IP address of your Docker container or docker compose service name
  port: 6379 // Default Redis port
})

redisClient.connect();
redisClient.on('connect', async function() {
console.log('Connected!');
});

// Initialize store.
let redisStore = new RedisStore({
  client: redisClient,
  prefix: "myapp:",
})

// Initialize session storage.
app.use(
  session({
    store: redisStore,
    resave: false, // required: force lightweight session keep alive (touch)
    saveUninitialized: false, // recommended: only save session when data exists
    secret: "keyboard cat",
  }),
)

// Middlewares para procesar datos JSON y datos codificados en URL.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración del motor de plantillas para usar archivos HTML.
app.set("view engine", "pug")
app.set("views", path.join(__dirname, "views"))

// Ruta GET para la página inicial.
app.get('/', (req, res) => {
  if (req.session.userid) {
    res.render('dashboard')
  } else {
    res.render('login')
  }
})


// Ruta GET para la página de error.
app.get("/error", (req, res) => res.render("error"))

// Ruta POST para manejar el login y el registro.
app.post("/", async (req, res) => {
    const { username, password } = req.body;
  
    if (!username || !password) {
      res.render("error", {
        message: "Please set both username and password",
      })
      return
    }

console.log(req.body, username, password);
    res.end()

    const saveSessionAndRenderDashboard = userid => {
      req.session.userid = userid
      req.session.save()
      res.render("dashboard")
    }

    const handleSignup = (username, password) => {
      redisClient.incr('userid', async (err, userid) => {
        redisClient.hSet('users', username, userid)
        
        const saltRounds = 10
        const hash = await bcrypt.hash(password, saltRounds)
        
        redisClient.hSet(`user:${userid}`, 'hash', hash, 'username', username)
        
        saveSessionAndRenderDashboard(userid)
    })
  }
     const handleLogin = (userid, password) => {
      client.hget(`user:${userid}`, 'hash', async (err, hash) => {
        const result = await bcrypt.compare(password, hash)
        if (result) {
          saveSessionAndRenderDashboard(userid)
        } else {
          res.render('error', {
            message: 'Incorrect password',
          })
          return
        }
      })
    }
     
    redisClient.hGet('users', username, (err, userid) => {
      if (!userid) {
        //user does not exist, signup procedure
        handleSignup(username, password)
      } else {
        handleLogin(userid, password)
        }
    })     
 })


app.listen(3000, () => console.log("Server ready"))

