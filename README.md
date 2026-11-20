# FastBank

**FastBank — Plataforma bancaria digital simulada full-stack diseñada para gestionar productos financieros desde una interfaz moderna y responsiva, implementando reglas contables estrictas y autenticación avanzada.**

[Abrir demo en vivo](https://fastbank-oficial.vercel.app)

> **Aviso sobre el alcance:** FastBank es un **entorno de simulación financiera con fines educativos y de portafolio**. No maneja dinero real; sus tarjetas no están conectadas a redes bancarias externas; las cotizaciones de inversión se generan internamente; y Aviator opera únicamente sobre el ledger interno simulado. No se conectan bancos, procesadores, bolsas ni proveedores externos.

## Funcionalidades

- Registro con validaciones de cédula colombiana, celular, mayoría de edad y carga de imagen del documento; verificación de correo con códigos temporales. La edad y los datos del documento no se verifican con una entidad gubernamental y la imagen no se conserva.
- Autenticación con JWT y Passkeys/WebAuthn. Recuperación de contraseña y PIN por correo; los códigos temporales se guardan como hashes SHA-256, mientras que las contraseñas y PIN se protegen con bcrypt.
- Dashboard con balance disponible, ahorros, inversiones, crédito y actividad.
- Transferencias internas con claves de idempotencia para evitar operaciones duplicadas.
- Solicitud y gestión simulada de tarjetas débito/crédito físicas y digitales.
- **FastCredit**, con límites escalonados por puntaje:

  | Nivel | Puntaje mínimo | Límite |
  | --- | ---: | ---: |
  | Base | 60 | COP 100.000 |
  | Escalada | 70 | COP 200.000 |
  | Avanzado | 80 | COP 500.000 |
  | Premium | 90 | COP 1.500.000 |

  Un pago anticipado o a tiempo suma 10 puntos, hasta un máximo de 100.
- Bolsillos de ahorro, pagos y recargas simulados, e inversiones con plazos de 7, 30, 90 y 180 días.
- Centro de ayuda con tickets y panel administrativo para gestión de usuarios, cuentas y soporte.
- Módulo recreativo Aviator con rondas, límites y movimientos sobre el ledger simulado.

## Arquitectura y seguridad

La aplicación es un monorepo cliente-servidor: **Vue 3** consume una API REST en **Express**; el backend usa actualmente **SQLite con `better-sqlite3`**. Hay esquema PostgreSQL/Neon y una utilidad de migración, pero el API de la aplicación aún no se ha convertido a PostgreSQL: Neon no es todavía el almacenamiento operativo de FastBank.

Las operaciones financieras usan transacciones atómicas y asientos balanceados de débito/crédito; las solicitudes rechazadas no registran movimientos en el ledger. Las operaciones compatibles aceptan claves de idempotencia. JWT, bcrypt, hash SHA-256 para códigos temporales y WebAuthn cubren distintos flujos de autenticación; las passkeys requieren HTTPS salvo en `localhost`.

Las cuentas de demostración se crean solo cuando se habilitan expresamente en desarrollo y se configuran sus credenciales en variables de entorno. El sembrado está deshabilitado en producción. No publiques credenciales ni uses datos reales. La demo y cualquier API desplegada pueden tener disponibilidad o configuración distintas.

## Stack tecnológico

- **Frontend:** Vue 3, Vite, Pinia, Vue Router, Tailwind CSS, Chart.js, Lucide Vue Next.
- **Backend:** Node.js, Express, JWT, WebAuthn/Passkeys, bcrypt, Nodemailer (SMTP).
- **Datos:** SQLite (`better-sqlite3`) en el API actual; esquema y utilidades de migración preparados para PostgreSQL (`pg`/Neon).
- **Pruebas:** Node.js test runner (`node --test`).

## Estructura del proyecto

```text
.
├── api/                 # Entradas/proxy de API para Vercel
├── public/              # Recursos públicos de la interfaz
├── server/
│   ├── services/        # Servicios de dominio, incluido Aviator
│   ├── banking.js       # Reglas y operaciones financieras
│   ├── db.js            # SQLite y creación/evolución del esquema
│   ├── email.js         # Correo de verificación y recuperación
│   └── index.js         # API REST de Express
├── src/
│   ├── components/      # Componentes Vue reutilizables
│   ├── data/            # Datos de interfaz
│   ├── router/          # Rutas del cliente
│   ├── stores/          # Estado de Pinia
│   ├── utils/           # Utilidades
│   └── views/           # Vistas de la aplicación
├── tests/               # Pruebas unitarias e integración
├── .env.example         # Nombres de variables, sin credenciales
├── package.json         # Scripts y dependencias del monorepo
├── render.yaml          # Plantilla de servicio para Render
├── vercel.json          # Configuración de frontend/proxy
└── vite.config.js       # Configuración de Vite
```

## Ejecución local

Requisitos: Node.js `^22.18.0` o `>=24.12.0` y npm.

1. Clona el repositorio y entra al directorio:

   ```sh
   git clone https://github.com/jeanortega-co/fastbank.git
   cd fastbank
   ```

2. Instala las dependencias desde la raíz. Frontend y backend comparten el `package.json`:

   ```sh
   npm install
   ```

3. Crea tu configuración local (PowerShell en Windows):

   ```powershell
   Copy-Item .env.example .env
   ```

   Completa `JWT_SECRET` con un valor aleatorio privado. Para registro y recuperación por correo, configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. No subas `.env`.

   Para crear cuentas de demo locales, establece `FASTBANK_SEED_DEMO_USERS=true` y define `DEMO_USER_PASSWORD`, `DEMO_USER_PIN`, `DEMO_ADMIN_PASSWORD` y `DEMO_ADMIN_PIN` con credenciales propias. Esta opción no está permitida en producción. Si no se configura SMTP, los flujos que envían correo no estarán disponibles.

4. Inicia backend y frontend juntos:

   ```sh
   npm run dev
   ```

   Abre la URL que muestra Vite (por defecto `http://localhost:5173`). El backend escucha por defecto en el puerto `3002` y SQLite crea `data/fastbank.sqlite` automáticamente. No configures `DATABASE_URL` para ejecutar la aplicación: el API de runtime sigue usando SQLite.

   También puedes iniciar los procesos por separado en terminales distintas con `npm run dev:server` y `npm run dev:client`.

5. Comprueba el proyecto:

   ```sh
   npm test
   npm run build
   ```

## Scripts disponibles

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Ejecuta Vite y Express en paralelo. |
| `npm run dev:client` | Ejecuta solo el frontend de desarrollo. |
| `npm run dev:server` | Ejecuta solo la API local. |
| `npm start` | Inicia el servidor API. |
| `npm run build` | Compila el frontend para producción. |
| `npm run preview` | Sirve localmente la compilación de Vite. |
| `npm test` | Ejecuta las pruebas con Node.js. |
| `npm run migrate:sqlite-to-neon` | Ejecuta la utilidad de importación SQLite → Neon; no convierte el API de runtime. |

## Despliegue

El frontend puede compilarse con `npm run build`. Vercel necesita `API_ORIGIN` para reenviar `/api/*` a una API desplegada. La plantilla `render.yaml` prepara un servicio API con `DATABASE_URL` y `JWT_SECRET`, pero **no despliegues el servicio como backend operativo hasta completar y validar la conversión de las consultas y transacciones del API a PostgreSQL**. La configuración de alojamiento por sí sola no activa el uso de Neon.

## Autor

**Jean Ortega** — [GitHub @jeanortega-co](https://github.com/jeanortega-co)
