const express = require("express")
const app = express()
const path = require("path")
const bcrypt = require('bcrypt')
const redis = require('redis')
const session = require('express-session')
const RedisStore = require("connect-redis").default
require('dotenv').config();

const redisHost = process.env.REDIS_HOST;
const redisPort = process.env.REDIS_PORT;
const sessionSecret = process.env.SESSION_SECRET;

// Conexión a Redis
const redisClient = redis.createClient({
  socket: {
    host: redisHost,
    port: redisPort
  }
})

redisClient.connect().catch(console.error);
redisClient.on('connect', () => {
  console.log('Connected to Redis!');
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
    resave: false, // Mantiene la sesión activa
    saveUninitialized: false, // Solo guarda la sesión si hay datos
    secret: "sessionSecret",
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
   // Si hay una sesión activa, renderiza el dashboard, de lo contrario, renderiza el login.
  if (req.session.userid) {
    res.render('dashboard')
  } else {
    res.render('login')
  }
})

// Ruta GET para la página de posteo de mensajes.
app.get("/post", (req, res) => {
  if (req.session.userid) {
    res.render("post")
  } else {
    res.render("login")
  }
})

// Ruta POST para que antes de postear un mensaje, si no ingreso, lo redirija al login. Luego incrementa el valor del post id para que sea unico
app.post("/post", async (req, res) => {
  if (!req.session.userid) {
    console.log("No session found, redirecting to login");
    res.render("login");
    return;
  }

  const { message } = req.body;

  try {
    const postid = await redisClient.incr("postid");
    console.log("Post ID incremented to:", postid, "and the message is:",  message);

    await redisClient.hSet(
      `post:${postid}`,
      "userid", req.session.userid,
      "message", message,
      "timestamp", Date.now().toString()
    );
    
    res.render("dashboard");
  } catch (err) {
    console.error("Error interacting with Redis:", err);
    res.render("error", { message: "Error creating post" });
  }
});


// Ruta POST para manejar el login y el registro.
app.post("/", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render("error", {
      message: "Please set both username and password",
    })
  }

  console.log(req.body);

  const saveSessionAndRenderDashboard = userid => {
    // Guarda el ID del usuario en la sesión y renderiza el dashboard.
    req.session.userid = userid
    req.session.save(err => {
      if (err) {
        return res.render('error', { message: 'Failed to save session' });
      }
      res.render("dashboard")
    });
  }

  const handleSignup = async (username, password) => {
    try {
       // Crea un nuevo ID de usuario y lo asigna al nombre de usuario proporcionado.
      const userid = await redisClient.incr('userid');
      await redisClient.hSet('users', username, userid);

      // Genera un hash de la contraseña y lo guarda junto con el nombre de usuario en Redis.
      const saltRounds = 10;
      const hash = await bcrypt.hash(password, saltRounds);
      
      await redisClient.hSet(`user:${userid}`, { hash, username });
      
      // Guarda la sesión y renderiza el dashboard.
      saveSessionAndRenderDashboard(userid);
    } catch (err) {
      console.error(err);
      res.render("error", { message: "Error during signup" });
    }
  }

  const handleLogin = async (userid, password) => {
    try {
      // Obtiene el hash de la contraseña del usuario desde Redis
      const hash = await redisClient.hGet(`user:${userid}`, 'hash');

      // Compara la contraseña proporcionada con el hash almacenado.
      const result = await bcrypt.compare(password, hash);

      if (result) {
        saveSessionAndRenderDashboard(userid); // Si la contraseña es correcta, guarda la sesión y renderiza el dashboard.
      } else {
        res.render('error', { message: 'Incorrect password' }); // Si la contraseña es incorrecta, muestra un mensaje de error.
      }
    } catch (err) {
      console.error(err);
      res.render("error", { message: "Error during login" });
    }
  }

  try {
    // Busca el ID de usuario basado en el nombre de usuario proporcionado.
    const userid = await redisClient.hGet('users', username);
    if (!userid) {
      // Si el usuario no existe, se realiza el registro
      await handleSignup(username, password);
    } else {
      // Si el usuario existe, se realiza el inicio de sesión
      await handleLogin(userid, password);
    }
  } catch (err) {
    console.error(err);
    res.render("error", { message: "Error during authentication" });
  }
})

app.listen(3000, () => console.log("Server ready"))

