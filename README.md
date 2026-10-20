# CRM Ventas

CRM para que el equipo siga cada negociación, desde el primer contacto hasta el cierre.

- **Negociaciones:** tablero por estados. Arrastras una tarjeta para cambiarla de estado.
- **Empresas:** datos de contacto, rubro, ciudad, presencia online y notas. Todo editable.
- **Comentarios y reuniones:** en la ficha de cada empresa se registran reuniones (con fecha y hora), llamadas, mensajes de WhatsApp, emails y notas. Los cambios de estado y de responsable quedan registrados solos.
- **Equipo:** cada compañero tiene su usuario. Cada negociación tiene un responsable y cada comentario muestra quién lo escribió.
- **Seguimientos:** fecha de próximo seguimiento por negociación. Las vencidas se marcan en rojo.
- **Flujos de WhatsApp:** secuencias editables de mensajes, plazos entre pasos, personalización por empresa e historial de envíos confirmados por el vendedor.

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

## Flujos de WhatsApp

1. En **Flujos WhatsApp**, crea o edita una plantilla. Cada paso tiene título, mensaje y días de espera. El primer plazo se cuenta desde el inicio del flujo; los siguientes se cuentan desde que el vendedor confirma el envío anterior.
2. Usa `{{empresa}}`, `{{contacto}}`, `{{rubro}}`, `{{ciudad}}` y `{{vendedor}}` para personalizar los mensajes. Si falta el nombre de contacto, se usa el de la empresa.
3. Pulsa **Contactar** desde Empresas, una tarjeta del tablero o la ficha. Selecciona la negociación y el flujo. Solo se permite un flujo en curso por negociación abierta.
4. Revisa y ajusta el mensaje. En la fecha prevista, **Abrir mensaje en WhatsApp** abre el chat con el texto preparado. Envía el mensaje en WhatsApp y luego pulsa **Ya lo envié · Registrar** en el CRM.
5. El CRM guarda el texto confirmado y el vendedor en el historial, avanza al siguiente paso y programa el seguimiento. El primer envío confirmado mueve una negociación en Prospecto a Contactado.
6. Consulta **Para hoy y vencidos** para continuar los seguimientos. Puedes filtrar por estado, empresa, flujo o por tus negociaciones.

Puedes pausar, reanudar, reprogramar o detener un flujo. **Respondió · Finalizar flujo** termina la secuencia para que el vendedor continúe la conversación. **No contactar** detiene todos los flujos de la empresa y bloquea nuevos flujos por WhatsApp. Cerrar una negociación como ganada o perdida también detiene su flujo.

El modo semimanual usa enlaces `wa.me` para celulares de Paraguay, como el contacto original del CRM. Abrir el chat no cuenta como envío: se confirma con **Ya lo envié · Registrar**. También se puede activar el modo automático descrito abajo. Ninguno requiere una cuenta de API de WhatsApp. Los plazos generan seguimientos dentro del CRM; no generan notificaciones externas.

Se incluye una plantilla marcada como **Borrador**, con textos de ejemplo para explorar necesidades de web, presencia digital y sistemas de gestión. Revísala antes de usarla. Puedes crear otras plantillas para cada servicio o tipo de negocio.

Las ejecuciones conservan una copia de los mensajes y plazos originales. Editar o archivar una plantilla afecta únicamente los nuevos seguimientos. Los flujos terminados y los mensajes registrados conservan su historial. Si el equipo cambia manualmente la fecha de seguimiento de una negociación, detener o avanzar su flujo conserva esa fecha; la fecha propia del flujo se administra desde Contactar.

Las tablas nuevas se crean automáticamente al arrancar, conservando los datos existentes. Usa la copia de seguridad habitual antes de actualizar una instalación.

## Automatización de WhatsApp Web

En **Flujos WhatsApp → Envíos automáticos por rubro**, un administrador puede asignar una plantilla a cada rubro y una regla general para los demás. **Simular lote y revisar mensajes** muestra qué empresas entrarán, los textos y las exclusiones, sin enviar ni crear seguimientos. **Preparar seguimientos** incorpora ese lote; no activa los envíos por sí solo. Un lote se debe volver a simular si los destinatarios o textos cambian antes de prepararlo.

Solo se incluyen negociaciones en Prospecto, con celular válido y sin flujos previos. Cada número se incorpora una sola vez al modo automático, aunque esté repetido en varias empresas. Los seguimientos conservan una copia del flujo y el nombre del vendedor que preparó el lote. Las reglas se aplican al preparar lotes nuevos, no modifican los ya preparados.

El modo principal es un **robot de Playwright que opera por pantalla**. Abre Chrome, entra al CRM con tu usuario, busca un prospecto pendiente, pulsa **Contactar · Abrir WhatsApp Web**, envía el texto y vuelve al CRM para marcar **Ya lo envié · Registrar**. No usa WhatsApp embebido ni APIs internas de WhatsApp para este recorrido. Puede ejecutarse en tu computadora mientras el CRM está alojado en un servidor. Necesita **Node.js 22.12 o superior**, Google Chrome y una carpeta persistente para la sesión.

```powershell
cd automation
npm ci
Copy-Item .env.example .env
# Edita .env: CRM_URL, CRM_EMAIL y CRM_PASSWORD de un administrador existente.
npm run robot:simulate  # entra al CRM y abre la simulación del lote sin enviar
npm run robot           # abre Chrome y recorre CRM → WhatsApp Web → Registrar
# npm start hace lo mismo que npm run robot
# npm run robot -- --once procesa como máximo un contacto y termina
```

Primero prepara un lote y habilita los envíos en **Flujos WhatsApp**. Al ejecutar el robot se abre una ventana propia de Chrome: si WhatsApp muestra un QR, escanéalo desde **Dispositivos vinculados** en tu teléfono. La sesión queda guardada para las siguientes ejecuciones. La pantalla **Robot navegador** del CRM muestra el contacto y el paso que está procesando. Por defecto el horario es de 9 a 18 (TZ del servidor, America/Asuncion por defecto), con un máximo de 30 intentos diarios y 60 segundos entre mensajes. Para detener nuevos envíos usa **Pausar envíos automáticos** o cierra el robot; un envío ya iniciado puede finalizar.

La URL remota debe usar HTTPS; se permite HTTP en localhost para desarrollo. `automation/.env` contiene las credenciales del CRM y `.session/playwright/` guarda el perfil y los recibos pendientes: ambos están excluidos de Git. No compartas esa carpeta ni ejecutes dos robots con el mismo perfil. Puedes indicar `WA_BROWSER_CHANNEL=msedge` para usar Edge, `WA_CHROME_PATH` para un ejecutable específico y `WA_SESSION_DIR` para elegir otro directorio persistente. El robot se ejecuta con una ventana visible.

Antes de enviar, el robot revisa los mensajes recibidos visibles en el chat, compara el texto preparado con el CRM y pulsa el control para verificar que el envío siga habilitado. Si encuentra una respuesta posterior al inicio del seguimiento, vuelve al CRM, registra la respuesta y finaliza la secuencia sin enviar. Si no puede interpretar las fechas visibles o confirmar el resultado, detiene el robot para revisión. Las fechas del chat se interpretan como día/mes/año con el perfil en español. No hay monitoreo continuo de todos los chats; la revisión ocurre al abrir cada contacto. La selección de ramas por respuesta se implementará al definir el embudo.

El robot hace un solo clic en Enviar y espera un mensaje saliente nuevo que coincida con el texto y tenga una marca de enviado. Guarda el identificador visible del mensaje, vuelve al CRM y registra el resultado. **La marca de enviado no confirma lectura.** Un mensaje antiguo idéntico no cuenta como evidencia del nuevo envío. Si no puede confirmar el resultado o pasan cinco minutos sin confirmación, el envío queda en **Revisar resultado**, sin reintento automático. Si WhatsApp confirmó el mensaje pero falló el registro en el CRM, queda un recibo en `.session/playwright/receipts/`; el robot no continúa hasta que revises ese resultado en el CRM y retires el recibo ya conciliado. No vuelvas a enviar ese mensaje. Si confirmas que no se envió, el flujo queda pausado; ese paso se puede completar desde el modo semimanual.

El recorrido depende de la interfaz de WhatsApp Web y puede necesitar ajustes si cambia. `WA_COMPOSER_SELECTOR` y `WA_SEND_SELECTOR` permiten ajustar el campo de mensaje y el botón de envío. La prueba usa el CRM real con una pantalla de WhatsApp interceptada y simulada; no verifica una cuenta real ni contacta prospectos. La vinculación y la primera prueba con un contacto autorizado se realizan en tu instalación.

El worker anterior por `whatsapp-web.js` sigue disponible como alternativa con `npm run worker` y `npm run worker:simulate`; no lo ejecutes a la vez que el robot de navegador. Su QR aparece en la terminal y su sesión está en `.session/auth/`. El modo predeterminado de `npm start` es ahora Playwright por pantalla.

### Verificación

```bash
npm test
npm run build
cd automation
npm ci
npm run test:browser
```

Las pruebas usan bases temporales aisladas y cubren validaciones, personalización, copias de plantillas, registros duplicados, fechas, pausas, respuestas, bloqueos y cierre de negociaciones. También prueban la API HTTP con el worker en simulación, límites, selección por rubro, envíos simulados, persistencia de recibos, desconexiones y resultados inciertos. `test:browser` verifica con Playwright los clics sobre el CRM y WhatsApp simulado, el retorno para registrar, la detección de respuestas y la detención ante falta de confirmación.

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

Desde el CRM: **Empresas → Importar lista** y sube el CSV de Outscraper (o cualquier CSV con columnas de nombre, teléfono, ciudad, etc.). Muestra una vista previa, omite las empresas con web propia y las cerradas, calcula la prioridad y no duplica las que ya existen. Si tienes un Excel, guárdalo como "CSV UTF-8".

También desde la terminal:

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
| GET/POST | `/api/whatsapp/flows` | Listar y crear plantillas de flujos |
| PATCH | `/api/whatsapp/flows/:id` | Guardar nombre, descripción, pasos y disponibilidad de una plantilla |
| GET | `/api/whatsapp/runs` | Listar ejecuciones y próximos seguimientos |
| POST | `/api/deals/:id/whatsapp` | Iniciar un flujo con `{ flow_id }` |
| POST | `/api/whatsapp/runs/:id/action` | Registrar envío, pausar, reanudar, reprogramar, marcar respuesta, detener o bloquear contacto |

Las acciones de ejecución requieren `version` (la versión recibida al consultar el flujo) para evitar cambios duplicados desde varias pestañas. `action` admite `sent`, `pause`, `resume`, `reschedule`, `responded`, `stop` y `do_not_contact`. `sent` requiere `message` con el texto realmente enviado; `resume` y `reschedule` requieren `next_due` en formato `YYYY-MM-DD`. La ficha de empresa incluye `whatsapp_runs` y `whatsapp_blocked`. Todos los miembros autenticados pueden gestionar flujos, con el mismo acceso de colaboración que las negociaciones.

La automatización requiere rol administrador. `GET/PATCH /api/whatsapp/automation` consulta el estado o guarda límites y activación; `POST .../rules` y `POST .../rules/remove` gestionan reglas; `POST .../preview` simula y devuelve una huella que se envía a `POST .../enroll` para preparar el lote. El worker usa `POST .../claim`, `POST .../jobs/:id/check`, `POST .../jobs/:id/result`, `POST .../reply`, `GET .../targets` y `POST .../heartbeat`. Un claim reserva un único mensaje con `claim_token`; una confirmación repetida no duplica el historial. `POST .../jobs/:id/resolve` permite revisar resultados inciertos desde el panel. Los tokens de claim no se devuelven en el listado del panel.

## Si más adelante necesitan PostgreSQL

SQLite alcanza de sobra para un equipo de ventas, con decenas de usuarios y cientos de miles de registros. Si igual quieren PostgreSQL (por ejemplo, para varios servidores), todo el SQL está en `server/db.js`. Ese es el único archivo que hay que adaptar, usando el paquete `pg`.
