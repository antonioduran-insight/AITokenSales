# Puesta en marcha: correo transaccional (y, aparte, el dominio de la app)

Para Antonio. Son **dos cosas distintas** que este documento antes mezclaba:

1. **El dominio desde el que salen los emails** — invitaciones y reset de
   contraseña. Es lo único que hace falta para que el correo funcione.
2. **El dominio en el que vive la app** — hoy `ai-token-sales.vercel.app`.
   Es una decisión aparte y el correo no la necesita.

Hacé la 1. La 2 solo si quieren mover la app a un dominio propio.

> Este documento decía `renly.it.com`, que fue una idea que no prosperó. El
> remitente ahora es **`noreply@send.insight-software.com`**.

---

# 1 · Correo transaccional

## 1.1 · Por qué un subdominio y no `insight-software.com` a secas

El remitente es `send.insight-software.com`, un subdominio dedicado, por dos
razones que cuestan caro si se ignoran:

- **Reputación.** El correo transaccional comparte reputación con el dominio
  que lo envía. Si el CRM manda una tanda que rebota o cae en spam, con el
  dominio corporativo eso arrastra al correo con el que el equipo le escribe a
  sus clientes. Con un subdominio, el daño queda ahí.
- **SPF.** Un dominio puede tener **un solo** registro SPF. Agregar un segundo
  no "suma" nada: rompe la autenticación de **todo** el correo de la empresa.
  En `insight-software.com` habría que *mezclar* el SPF existente de Google
  Workspace con el de Resend, editando a mano un registro del que depende el
  correo diario. En `send.` no hay ninguno, así que se crea y listo.

## 1.2 · Verificar el dominio en Resend

1. [resend.com](https://resend.com) → *Domains* → *Add Domain* →
   **`send.insight-software.com`**
2. Resend muestra los registros DNS que hay que cargar (un `TXT` de SPF, un
   `CNAME` o `TXT` de DKIM, y a veces un `MX`)
3. Cargalos en el panel de DNS de `insight-software.com`

   > **Ojo con el nombre del registro.** Muchos paneles asumen el dominio y hay
   > que escribir solo la parte de adelante. Si Resend pide un registro para
   > `send.insight-software.com`, en el panel suele ir como `send`, no como el
   > nombre completo — cargarlo entero produce
   > `send.insight-software.com.insight-software.com`, que no resuelve y deja
   > la verificación colgada sin decir por qué.

4. Esperá a que Resend diga **Verified** ✅ (de 10 minutos a unas horas)

> **Hasta que diga *Verified*, Resend acepta los envíos sin error pero solo los
> entrega a tu propia dirección.** Es la causa número uno de "no me llega el
> mail": parece que funciona y no llega a nadie más.

## 1.3 · Crear la API key

*API Keys* → *Create API Key* → permiso **Sending access** → **copiala en ese
momento**, no se vuelve a mostrar (empieza con `re_`).

## 1.4 · Variables de entorno en Vercel

Vercel → *Settings* → *Environment Variables*:

| Nombre | Valor | Sensible |
|---|---|---|
| `RESEND_API_KEY` | la clave del paso anterior | **Sí** |
| `EMAIL_FROM` | `Insight Software <noreply@send.insight-software.com>` | No |

- Tildá **Production y Preview**, las dos.
- `EMAIL_FROM` es opcional: si no está, el código usa exactamente ese valor por
  defecto. Cargala igual, así cambiar el remitente no requiere un deploy.
- `RESEND_API_KEY` marcada como sensible queda de una sola dirección: no la
  volvés a ver en el panel. No importa — si se pierde, se genera otra.
- **Nunca** le pongas el prefijo `NEXT_PUBLIC_`: eso la empaquetaría en el
  bundle del navegador.

### Después de agregarlas, redesplegá

Las variables **no se aplican a los despliegues que ya existen**. Vercel →
*Deployments* → el último → menú `···` → *Redeploy*.

Si no hacés esto, agregaste las variables y no pasa nada. Es el error más común
después del dominio sin verificar.

## 1.5 · Comprobar

```bash
curl -X POST https://ai-token-sales.vercel.app/api/auth/forgot-password \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@insight-software.com","locale":"es"}'
```

| Respuesta | Qué significa |
|---|---|
| `{"found":true,"reason":"sent"}` | Resend **aceptó** el envío. Si aun así no llega: el dominio todavía no está *Verified*, o cayó en spam |
| `{"found":true,"reason":"send_failed"}` | El envío falló. El motivo textual está en Vercel → *Logs*, buscando `[forgot-password]` |
| `{"found":false,"reason":"no_account"}` | Ese email no existe como usuario. Probá con otro |
| `{"found":true,"reason":"deactivated"}` | La cuenta existe pero está desactivada |

El endpoint está limitado a 5 intentos por minuto por IP.

## 1.6 · Las invitaciones que quedaron sin enviar

Las personas invitadas mientras el correo no funcionaba **existen igual en la
base**: la cuenta se crea antes de intentar el mail, y un fallo de envío
deliberadamente no la borra. No hay que volver a invitarlas — botón **"Reset
password"** en su fila de Usuarios y les llega el enlace para definir su
contraseña.

---

# 2 · Dominio propio para la app (opcional)

Solo si quieren que el CRM deje de vivir en `ai-token-sales.vercel.app`. El
correo del punto 1 **no depende de esto**.

1. Vercel → proyecto **AITokenSales** → *Settings* → *Domains* → *Add* →
   el dominio o subdominio elegido
2. Cargá en el DNS los registros que muestre Vercel (normalmente un `A` a
   `76.76.21.21`, o un `CNAME`)
3. Esperá a que Vercel diga **Valid Configuration** ✅
4. **Supabase → Authentication → URL Configuration**: actualizá *Site URL* y
   agregá el nuevo origen a *Redirect URLs*

El paso 4 no es opcional si hacen el 1: los enlaces de invitación y de reset
vuelven a `/auth/callback`, y Supabase rechaza cualquier redirect a un origen
que no tenga en la lista. Sin eso, el mail llega y el link no entra.

---

## Resumen para tildar

**Correo (necesario):**

- [ ] `send.insight-software.com` agregado en Resend
- [ ] Registros DNS cargados → *Verified* ✅
- [ ] API key creada con *Sending access* y copiada
- [ ] `RESEND_API_KEY` (sensible) y `EMAIL_FROM` en Vercel, en Production y Preview
- [ ] Redeploy hecho
- [ ] `curl` a `/api/auth/forgot-password` devuelve `sent` **y el mail llega**
- [ ] Reenviadas las invitaciones pendientes con "Reset password"

**Dominio de la app (opcional):**

- [ ] Dominio agregado en Vercel → *Valid Configuration*
- [ ] Site URL y Redirect URLs actualizadas en Supabase

Cualquier cosa que se trabe, pasá la captura de dónde te quedaste.
