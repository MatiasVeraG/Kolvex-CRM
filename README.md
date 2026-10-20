# CRM Ventas

CRM para que el equipo siga cada negociación, desde el primer contacto hasta el cierre.

- **Negociaciones:** tablero por estados. Arrastras una tarjeta para cambiarla de estado.
- **Empresas:** datos de contacto, rubro, ciudad, presencia online y notas. Todo editable.
- **Comentarios y reuniones:** en la ficha de cada empresa se registran reuniones (con fecha y hora), llamadas, mensajes de WhatsApp, emails y notas. Los cambios de estado y de responsable quedan registrados solos.
- **Equipo:** cada compañero tiene su usuario. Cada negociación tiene un responsable y cada comentario muestra quién lo escribió.
- **Seguimientos:** fecha de próximo seguimiento por negociación. Las vencidas se marcan en rojo.

Viene con los 369 prospectos de la planilla de Outscraper listos para importar (`data/prospectos.json`).

## Stack

| Parte | Tecnología |
|---|---|
| Servidor | Node.js 22 (módulo `http`), sin frameworks |
| Base de datos | SQLite incluido en Node (`node:sqlite`), un solo archivo |
| Interfaz | React 19, compilado con esbuild |
| Login | Contraseñas con scrypt, sesiones firmadas con HMAC |

El servidor no tiene dependencias externas: solo usa lo que trae Node. React y esbuild se usan para compilar la interfaz.

## Requisitos

- **Node.js 22.9 o más nuevo** (`node -v`). Se descarga en https://nodejs.org (versión LTS).

## Probarlo en tu computadora

```bash
npm install
npm run build
npm run import -- data/prospectos.json   # carga los prospectos (opcional)
npm start
```

Abre http://localhost:3000.

La primera vez que arranca, si no hay usuarios, crea un administrador y muestra en la consola el email (`admin@crm.local`) y una contraseña generada. Entra con esos datos, ve a **Mi cuenta** para cambiar la contraseña y a **Equipo** para crear los usuarios de tus compañeros.

Para trabajar en el código: `npm run dev` recompila la interfaz y reinicia el servidor cada vez que guardas.

## Configuración

Copia `.env.example` como `.env` y completa los valores:

| Variable | Para qué sirve |
|---|---|
| `PORT` | Puerto del servidor (por defecto 3000) |
| `SESSION_SECRET` | Clave para firmar las sesiones. Si falta, se genera una y se guarda en `data/.session-secret` |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Primer administrador. Solo se usan cuando la base está vacía |
| `RESET_ADMIN` | Para recuperar el acceso: con `true`, al arrancar se crea el usuario de `ADMIN_EMAIL` como administrador, o se le pone la contraseña de `ADMIN_PASSWORD`. Bórrala después de entrar |
| `SESSION_DAYS` | Días que dura una sesión (por defecto 14) |
| `DATA_DIR` | Carpeta de la base de datos (por defecto `./data`) |
| `TZ` | Zona horaria, para calcular los seguimientos vencidos (`America/Asuncion`) |

## Ponerlo en un servidor

### Opción A: con Docker (recomendada)

En un VPS con Docker instalado (DigitalOcean, Hetzner, Contabo, etc.):

```bash
cp .env.example .env        # y completa los valores
docker compose up -d --build
docker compose exec crm npm run import -- data/prospectos.json   # opcional
```

La base de datos queda en el volumen `crm-data`, así que no se pierde al actualizar.

Para actualizar después de cambiar el código: `docker compose up -d --build`.

### Opción B: sin Docker

```bash
npm install
npm run build
cp .env.example .env        # y completa los valores
npm start
```

Para que siga corriendo y se reinicie solo, usa un gestor de procesos como `pm2` (`pm2 start npm --name crm -- start`) o un servicio de systemd.

### HTTPS y dominio

Pon el CRM detrás de un proxy con HTTPS, por ejemplo Caddy, que saca el certificado solo:

```
crm.tudominio.com {
    reverse_proxy localhost:3000
}
```

No lo expongas en internet sin HTTPS: las contraseñas viajarían sin cifrar.

## Copias de seguridad

```bash
npm run backup                      # guarda en data/backups/crm-AAAAMMDD-HHMM.db
docker compose exec crm npm run backup   # con Docker (queda en el volumen, en /data/backups)
```

Se puede hacer con el servidor andando. Conviene programarlo una vez por día (cron) y copiar los archivos fuera del servidor.

## Importar más empresas

```bash
npm run import -- archivo.json
npm run import -- archivo.csv
```

Acepta columnas como `name`/`Negocio`, `rubro`, `ciudad`, `direccion`, `telefono`, `email`, `web`, `presencia`, `rating`, `reviews`, `maps_url`, `prioridad`, `place_id`. Las empresas que ya existen se saltean, así que se puede correr varias veces sin duplicar.

## Permisos

| Acción | Miembro | Administrador |
|---|---|---|
| Ver todo, crear y editar empresas y negociaciones | Sí | Sí |
| Agregar comentarios y reuniones | Sí | Sí |
| Editar o borrar comentarios | Solo los suyos | Todos |
| Eliminar empresas y negociaciones | No | Sí |
| Crear, editar y desactivar usuarios | No | Sí |

## Estructura

```
server/
  index.js        Servidor HTTP: API en /api y archivos de la interfaz
  routes.js       Endpoints de la API y validaciones
  db.js           Esquema y consultas SQL (todo el SQL está aquí)
  auth.js         Contraseñas, sesiones y administrador inicial
  scripts/        import.js, backup.js, dev.js
client/
  src/pages/      Tablero, Empresas, Ficha de empresa, Equipo, Mi cuenta, Login
  src/components/ Componentes compartidos
  build.js        Compilación con esbuild
data/
  prospectos.json Prospectos de la planilla de Outscraper
```

## API

Todas las rutas (salvo el login) piden el encabezado `Authorization: Bearer <token>`.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/auth/login` | Login con `{ email, password }`, devuelve `{ token, user }` |
| GET | `/api/me` | Usuario actual |
| POST | `/api/me/password` | Cambiar contraseña |
| GET | `/api/meta` | Estados, tipos de comentario, rubros y ciudades |
| GET/POST | `/api/users` | Listar y crear usuarios |
| PATCH | `/api/users/:id` | Editar, desactivar o cambiar contraseña de un usuario |
| GET/POST | `/api/companies` | Listar (con filtros y paginación) y crear empresas |
| GET/PATCH/DELETE | `/api/companies/:id` | Ficha completa, editar, eliminar |
| GET | `/api/deals` | Negociaciones para el tablero |
| POST | `/api/companies/:id/deals` | Nueva negociación para una empresa |
| PATCH/DELETE | `/api/deals/:id` | Cambiar estado, responsable, monto, seguimiento |
| POST | `/api/companies/:id/comments` | Agregar comentario o reunión |
| PATCH/DELETE | `/api/comments/:id` | Editar o borrar un comentario |
| GET | `/api/stats` | Números del tablero |

## Si más adelante necesitan PostgreSQL

SQLite alcanza de sobra para un equipo de ventas, con decenas de usuarios y cientos de miles de registros. Si igual quieren PostgreSQL (por ejemplo, para varios servidores), todo el SQL está en `server/db.js`. Ese es el único archivo que hay que adaptar, usando el paquete `pg`.
