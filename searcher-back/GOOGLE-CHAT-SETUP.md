# Casos de edición desde Google Chat

Habilita que el rol `inventario_compras` edite una factura de compra **solo** cuando
exista un caso abierto en el espacio de Google Chat.

## Cómo funciona

1. Alguien abre un **hilo nuevo** en el espacio mencionando al bot:

   ```
   @SmartAlegra compra 1280 medellin
   ```

   Hace falta la sede porque los números de factura **se repiten entre sedes**
   (cada sede es una cuenta de Alegra independiente).

2. El bot busca esa compra y responde en el mismo hilo:
   - si existe → abre el caso y confirma;
   - si no → lo dice y no habilita nada.

3. Con el caso abierto, el usuario de inventario ve el botón **Editar** en esa
   factura (y solo en esa). Ventas, anulaciones y demás siguen fuera de su alcance.

4. Al guardar, el bot publica en el hilo **qué cambió, quién y cuándo**, y el caso
   queda cerrado. Para volver a editarla hay que abrir **otro hilo**.

Toda edición de compras —también las de `admin` y `compras`, que no necesitan
caso— queda registrada en la tabla `bill_edit_audits`.

## Por qué hay que mencionar al bot

Una app de Chat solo recibe los mensajes de un espacio **donde se la @menciona**.
Leer todos los mensajes exigiría la Workspace Events API con Pub/Sub y
consentimiento del administrador de Workspace. La mención, además, distingue los
casos reales del resto de la conversación del espacio.

## Montaje en Google Cloud (una sola vez)

1. **Proyecto**: cree uno en <https://console.cloud.google.com> y anote el
   **número de proyecto** (no el ID).
2. **Habilite la Google Chat API** en ese proyecto.
3. **Configure la app de Chat** (Chat API → Configuración):
   - Nombre: `SmartAlegra` (el que se usará en la mención), más avatar y descripción.
   - **Habilitar funciones interactivas**: activado.
   - Funcionalidad → marque **"Unirse a espacios y conversaciones grupales"**.
     Es la única obligatoria: sin ella el bot no puede estar en el espacio.
     - *No hay casilla para mensajes 1:1*: eso es implícito.
     - *"Admitir la página principal de la app"* (evento `APP_HOME`) **no se usa**;
       déjela sin marcar.
   - Conexión: **URL del extremo HTTP** →
     `https://<tu-backend>.up.railway.app/google-chat/events`
   - Permisos: los usuarios de su dominio.
4. **Cuenta de servicio**: cree una en el mismo proyecto y genere una clave JSON.
   De ese archivo saldrán el correo y la clave privada.
5. **Agregue la app al espacio** donde se abren los casos.

## Variables de entorno

```bash
# Número de proyecto de Google Cloud; es la audiencia del token del webhook.
# Sin esta variable el endpoint RECHAZA todos los eventos (falla cerrado).
GOOGLE_CHAT_AUDIENCE=123456789012

# Cuenta de servicio, para que el bot pueda publicar en el hilo.
GOOGLE_CHAT_SA_EMAIL=smartalegra-bot@mi-proyecto.iam.gserviceaccount.com
GOOGLE_CHAT_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"

# Opcional: restringe los casos a un solo espacio. Si se omite, se aceptan todos.
GOOGLE_CHAT_SPACE=spaces/AAAAbbbbCCC
```

La clave privada va **en una sola línea**, con los saltos como `\n` literales
(el código los reconvierte).

## Comportamiento sin configurar

El sistema no se cae si falta algo, pero tampoco finge funcionar:

| Falta | Qué pasa |
|---|---|
| `GOOGLE_CHAT_AUDIENCE` | El webhook rechaza todo. No se abren casos. El rol de inventario no puede editar nada. |
| Credenciales de la cuenta de servicio | Los casos se abren y la edición funciona, pero **el resumen no se publica en el hilo**. Queda registrado en `bill_edit_audits` con `chatNotified = false` y el motivo en `chatError`. |

Los demás roles (`admin`, `compras`) no dependen de nada de esto.

## Verificación

```bash
# Debe responder 401: el endpoint es público pero solo acepta tokens de Chat
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://<tu-backend>.up.railway.app/google-chat/events \
  -H 'Content-Type: application/json' -d '{"type":"MESSAGE"}'
```

Luego, en el espacio, abra un hilo con `@SmartAlegra compra <numero> <sede>` y
confirme que el bot responde.
