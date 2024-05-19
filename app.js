const express = require("express")
const path = require("path")
const bcrypt = require('bcrypt')
const session = require('express-session')
const redis = require('redis')
const RedisStore = require("connect-redis")(session);
require('dotenv').config();
const { promisify } = require('util')
const { formatDistance } = require("date-fns")

const app = express()


const redisHost = process.env.REDIS_HOST;
const redisPort = process.env.REDIS_PORT || 6379;
const sessionSecret = process.env.SESSION_SECRET;

// Conexión a Redis
const client = redis.createClient({
  socket: {
    host: redisHost,
    port: redisPort
  }
})
client.on('error', (err) => console.log('Redis Client Error', err));



const ahget = promisify(client.hget).bind(client)
const asmembers = promisify(client.smembers).bind(client)
const ahkeys = promisify(client.hkeys).bind(client)
const aincr = promisify(client.incr).bind(client)
const alrange = promisify(client.lrange).bind(client)


// Middlewares para procesar datos JSON y datos codificados en URL.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// // Initialize store.
const redisStore = new RedisStore({
  client: client,
  prefix: "myapp:",
})

// Initialize session storage.
app.use(
  session({
    store: redisStore,
    resave: false, // Mantiene la sesión activa
    saveUninitialized: false, // Solo guarda la sesión si hay datos
    cookie: {
      maxAge: 36000000,
      httpOnly: false,
      secure: false,
    }, 
    secret: sessionSecret,
  }),
)

// Configuración del motor de plantillas para usar archivos HTML.
app.set("view engine", "pug")
app.set("views", path.join(__dirname, "views"))

// Ruta GET para la página inicial.
app.get('/', async (req, res) => {
  if (req.session.userid) {
    const currentUserName = await ahget(`user:${req.session.userid}`, 'username')
    const following = await asmembers(`following:${currentUserName}`)    
    const users = await ahkeys('users')
    
    const timeline = []
    const posts = await alrange(`timeline:${currentUserName}`, 0, 100)

    for (post of posts) {
      const timestamp = await ahget(`post:${post}`, 'timestamp')
      const timeString = formatDistance(
        new Date(),
        new Date(parseInt(timestamp))
      )

      timeline.push({
        message: await ahget(`post:${post}`, 'message'),
        author: await ahget(`post:${post}`, 'username'),
        timeString: timeString,
      })
    }

    res.render('dashboard', {
      users: users.filter(
        (user) => user !== currentUserName && following.indexOf(user) === -1
      ),
      currentUserName,
      timeline
    })
  } else {
    res.render('login')
  }
})


// Ruta GET para la página de posteo de mensajes.
app.get('/post', (req, res) => {
  if (req.session.userid) {
    res.render('post')
  } else {
    res.render('login')
  }
})


// Ruta POST para que antes de postear un mensaje, si no ingreso, lo redirija al login. Luego incrementa el valor del post id para que sea unico
app.post('/post', async (req, res) => {
  if (!req.session.userid) {
    res.render('login')
    return
  }
  
  const { message } = req.body
  const currentUserName = await ahget(`user:${req.session.userid}`, 'username')
  const postid = await aincr('postid')
  client.hmset(`post:${postid}`, 'userid', req.session.userid, 'username', currentUserName, 'message', message, 'timestamp', Date.now())
  client.lpush(`timeline:${currentUserName}`, postid)

  const followers = await asmembers(`followers:${currentUserName}`)
  for (follower of followers) {
    client.lpush(`timeline:${follower}`, postid)
  }

  res.redirect('/')
})

// Ruta POST para manejar los seguidores
app.post('/follow', (req, res) => {
  if (!req.session.userid) {
    res.render('login')
    return
  }

  const { username } = req.body
  
  client.hget(`user:${req.session.userid}`, 'username', (err, currentUserName) => {
    client.sadd(`following:${currentUserName}`, username)
    client.sadd(`followers:${username}`, currentUserName)
  })

  res.redirect('/')
})

// Ruta POST para manejar el login y el registro.
app.post('/', (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    res.render('error', { 
      message: 'Please set both username and password' 
    })
    return
  }

  const saveSessionAndRenderDashboard = userid => {
    req.session.userid = userid
    req.session.save()
    res.redirect('/')
  }

  const handleSignup = (username, password) => {
    client.incr('userid', async (err, userid) => {
      client.hset('users', username, userid)

      const saltRounds = 10
      const hash = await bcrypt.hash(password, saltRounds)

      client.hset(`user:${userid}`, 'hash', hash, 'username', username)

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

  client.hget('users', username, (err, userid) => {
    if (!userid) { //signup procedure
      handleSignup(username, password)
    } else { //login procedure
      handleLogin(userid, password)
    }
  })
})




app.listen(3000, () => console.log("Server ready"))

