# Puesta en marcha: dominio, Vercel y Resend

Para Antonio. Son cuatro pasos y **el orden importa**: Resend no se puede
verificar hasta que el dominio esté comprado, y las variables de entorno no
sirven hasta que Resend esté verificado.

Contá con esperar entre pasos: los cambios de DNS tardan de 10 minutos a unas
horas en propagarse.

---

## 1 · Comprar el dominio

`renly.it.com` — en el registrador que prefieras (Namecheap, Cloudflare,
Porkbun).

Lo único que importa acá: **tenés que quedarte con acceso al panel de DNS**,
porque los pasos 2 y 3 son los dos agregar registros ahí.

---

## 2 · Conectar el dominio a Vercel

1. Vercel → proyecto **AITokenSales** → *Settings* → *Domains*
2. *Add* → escribí `renly.it.com` → *Add*
3. Vercel muestra uno o dos registros DNS (normalmente un `A` que apunta a
   `76.76.21.21`, y un `CNAME` para `www`)
4. Copiá esos registros al panel de DNS del registrador
5. Esperá a que en Vercel diga **Valid Configuration** ✅

Por ahora el dominio pelado entra directamente al CRM. Eso es a propósito: la
landing vive en `renly.it.com/landing` hasta que decidamos mover el CRM a un
subdominio.

### Y apenas ande, avisá — hay un paso en Supabase

Supabase → *Authentication* → *URL Configuration*:

- **Site URL**: `https://renly.it.com`
- **Redirect URLs**: agregá `https://renly.it.com/auth/callback`

Sin esto, los links de invitación y de recuperar contraseña **no vuelven a la
app**. Es el error más fácil de pasar por alto, porque todo lo demás funciona
igual.

---

## 3 · Configurar Resend

1. Entrá a [resend.com](https://resend.com) con la cuenta **Teams** del equipo
2. *Domains* → *Add Domain* → `renly.it.com`
3. Resend muestra **tres registros DNS** (un `TXT` para SPF, un `CNAME` o `TXT`
   para DKIM, y a veces un `MX`)
4. Copiálos al mismo panel de DNS del paso 2
5. Esperá a que Resend diga **Verified** ✅
6. *API Keys* → *Create API Key* → permiso *Sending access* → **copiá la clave
   ahora**, no se vuelve a mostrar

> **Ojo:** hasta que el dominio diga *Verified*, Resend acepta los envíos sin
> error pero **solo los entrega a tu propia dirección**. Es la causa número uno
> de "no me llega el mail" — parece que funciona y no llega a nadie más.

---

## 4 · Variables de entorno en Vercel

Vercel → *Settings* → *Environment Variables*. Agregá estas dos:

| Nombre | Valor |
|---|---|
| `RESEND_API_KEY` | la clave del paso 3.6 (empieza con `re_`) |
| `EMAIL_FROM` | `Renly <noreply@renly.it.com>` |

En **Environment**, tildá **Production** y **Preview** (las dos).

### Después de agregarlas, redesplegá

Las variables de entorno **no se aplican a los despliegues que ya existen**.
Vercel → *Deployments* → el último → menú `···` → *Redeploy*.

Si no hacés esto, agregaste las variables y no pasa nada. Es el segundo error
más común.

---

## Comprobar que quedó bien

Entrá a `https://renly.it.com/es/forgot-password`, poné tu email y dale enviar.

| Lo que ves | Qué significa |
|---|---|
| Llega el mail | ✅ listo, todo funciona |
| "No hay ninguna cuenta con ese email" | El dominio y Resend andan; probá con un email que sí tenga cuenta |
| "No se pudo enviar" | Falta la variable, o el dominio en Resend no está *Verified* |
| No carga la página | El DNS todavía no propagó, o falta el paso 2 |

Si el mail llega pero el link no te trae de vuelta a la app: falta el paso de
Supabase del final del punto 2.

---

## Resumen para tildar

- [ ] Dominio comprado, con acceso al DNS
- [ ] Registros de Vercel cargados → *Valid Configuration*
- [ ] Site URL y Redirect URL cargadas en Supabase
- [ ] Registros de Resend cargados → *Verified*
- [ ] API key creada y copiada
- [ ] `RESEND_API_KEY` y `EMAIL_FROM` en Vercel, en Production y Preview
- [ ] Redeploy hecho
- [ ] Probado desde `/forgot-password`

Cualquier cosa que se trabe, pasá la captura de dónde te quedaste.
