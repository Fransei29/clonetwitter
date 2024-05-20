// Importación de módulos necesarios
const express = require("express")
const path = require("path")
const bcrypt = require('bcrypt')
const session = require('express-session')
const redis = require('redis')
const RedisStore = require("connect-redis")(session);
require('dotenv').config();
const { promisify } = require('util')
const { formatDistance } = require("date-fns")

// Inicialización de la aplicación Express
const app = express()

// Configuración de variables de entorno
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

// Promisificación de métodos Redis para uso asincrónico
const ahget = promisify(client.hget).bind(client)
const asmembers = promisify(client.smembers).bind(client)
const ahkeys = promisify(client.hkeys).bind(client)
const aincr = promisify(client.incr).bind(client)
const alrange = promisify(client.lrange).bind(client)


// Middlewares para procesar datos JSON y datos codificados en URL.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Inicializar store.
const redisStore = new RedisStore({
  client: client,
  prefix: "myapp:",
})

// Configuracion del middleware para la sesión
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
    // Obtener el nombre de usuario del ID de sesión
    const currentUserName = await ahget(`user:${req.session.userid}`, 'username')
    // Obtener la lista de usuarios seguidos
    const following = await asmembers(`following:${currentUserName}`)   
    // Obtener la lista de todos los usuarios 
    const users = await ahkeys('users')
    
    const timeline = []
    // Obtener los IDs de los posts del timeline del usuario actual (máximo 100 posts)
    const posts = await alrange(`timeline:${currentUserName}`, 0, 100)

    // Iterar sobre los IDs de los posts para obtener los datos de cada post
    for (post of posts) {
      // Obtener el timestamp del post
      const timestamp = await ahget(`post:${post}`, 'timestamp')
      // Convertir el timestamp a una cadena de tiempo legible (ej. "hace 5 minutos")
      const timeString = formatDistance(
        new Date(),
        new Date(parseInt(timestamp))
      )
      // Añadir los datos del post al timeline
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


// Ruta POST para postear un mensaje.
app.post('/post', async (req, res) => {
  if (!req.session.userid) {
    res.render('login')
    return
  }
  
  const { message } = req.body
  const currentUserName = await ahget(`user:${req.session.userid}`, 'username')
  const postid = await aincr('postid')
   // Guardar el mensaje en Redis
  client.hmset(`post:${postid}`, 'userid', req.session.userid, 'username', currentUserName, 'message', message, 'timestamp', Date.now())
  // Agregar el post al timeline del usuario actual
  client.lpush(`timeline:${currentUserName}`, postid)
  
  // Agregar el post al timeline de los seguidores
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
  
  // Agregar el usuario a la lista de seguidos y seguidores
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
  
  // Guardar la sesión y renderizar el dashboard
  const saveSessionAndRenderDashboard = userid => {
    req.session.userid = userid
    req.session.save()
    res.redirect('/')
  }
  
  // Manejar el registro de usuario
  const handleSignup = (username, password) => {
    client.incr('userid', async (err, userid) => {
      client.hset('users', username, userid)

      const saltRounds = 10
      const hash = await bcrypt.hash(password, saltRounds)

      client.hset(`user:${userid}`, 'hash', hash, 'username', username)

      saveSessionAndRenderDashboard(userid)
    })
  }
  
  // Manejar el login de usuario
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
  
  // Verificar si el usuario existe en Redis y manejar login o registro
  client.hget('users', username, (err, userid) => {
    if (!userid) { //signup
      handleSignup(username, password)
    } else { //login 
      handleLogin(userid, password)
    }
  })
})


app.listen(3000, () => console.log("Server ready"))

