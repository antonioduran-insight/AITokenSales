# SSO (SAML) — plan

Decidido 05/08/2026.

**Estado:** fases 2, 3 y 4 implementadas. Falta la fase 1 (Antonio, en el
dashboard de Supabase) y la fase 5 (primer cliente). Migraciones:
`20260805_sso_roster.sql` corrida ✅ · `20260805_sso_domains.sql` **pendiente**.

---

## La restricción que define el diseño

Supabase Auth **no enlaza identidades**:

> Si `maria@acme.com` se registró con contraseña y después usa el SSO de su
> empresa, van a existir **dos cuentas** `maria@acme.com`.

Y en este CRM `public.users.id` **es** el id de `auth.users`. Entonces una
persona que ya tiene cuenta y entra por SSO llega como alguien distinto, sin
perfil, sin sus leads.

**Decisión: opción A — SSO solo para clientes nuevos.** Un cliente arranca con
SSO desde el día uno. No migramos cuentas existentes; si un cliente actual lo
pide, se diseña esa migración entonces, con su caso concreto delante.

### Lo que A fuerza, y que no era obvio

Con A **no se puede invitar por email**. Una invitación crea identidad con
contraseña, y el primer login SSO de esa persona crearía la segunda cuenta que
A justamente evita.

Eso deja dos caminos, y uno es malo: aprovisionar automáticamente a cualquiera
que exista en el IdP del cliente — que es la forma de la auto-unión por dominio
ya descartada, con el agravante de que 200 personas en un Okta se llevarían 200
asientos.

El camino elegido es un tercero.

---

## El padrón

El admin **pre-registra** quién puede entrar: email, rol, área y sede. Eso no
crea ninguna cuenta de auth — es una lista de autorizados.

Cuando alguien llega por SSO, se busca su email en el padrón de su organización:

- **Está** → se crea el perfil con los atributos que el admin ya definió, se
  consume la entrada del padrón, y entra
- **No está** → se rechaza, aunque su autenticación SAML haya sido impecable

### Por qué así

| Pregunta abierta | Cómo la cierra el padrón |
|---|---|
| ¿Qué área recibe? | La que puso el admin. **Nunca entra sin área** — un SDR sin área ve un CRM vacío que parece roto |
| ¿Qué rol? | El del padrón. **Nunca del IdP**: que el Okta del cliente diga *quién* es alguien no dice *qué puede hacer* acá |
| ¿Y `max_seats`? | Se valida al agregar al padrón, con el chequeo que ya existe en `POST /api/users` |
| ¿Un Okta con 200 personas? | Solo entra quien está en la lista |

### La llave de emergencia

Si el IdP del cliente se cae y toda su gente es SSO-only, no entra nadie.

**El admin que Global Admin crea al dar de alta la organización se queda con
contraseña y nunca usa SSO.** Explícito y documentado, no un accidente. Es la
única cuenta de esa org con contraseña.

### Lo que NO hace falta

`sso_enforced` sale del plan. Las dos poblaciones son disjuntas por
construcción: los usuarios del padrón no tienen contraseña, y el admin de
emergencia no usa SSO. No hay nada que forzar.

---

## Reparto

| Fase | Quién | Bloquea a |
|---|---|---|
| 1 · Habilitar SAML en Supabase | Antonio | Solo a las pruebas |
| 2 · Modelo de datos | yo | Fase 3 |
| 3 · Login, padrón y aprovisionamiento | yo | Fase 5 |
| 4 · Pantalla en Global Admin | yo | Fase 5 |
| 5 · Alta del primer cliente | Antonio + Nicola | — |

Las fases 2 a 4 no dependen de la 1. Se pueden hacer en paralelo.

---

## Fase 1 · Supabase — Antonio

1. **Authentication → Sign In / Providers → SAML 2.0 → activar.**
   Viene apagado. Disponible desde el plan Pro, que ya tenemos.

2. **Instalar el CLI** (v1.46.4+). Las conexiones SAML **no se administran
   desde el dashboard**: ahí solo se habilita.
   ```bash
   brew install supabase/tap/supabase && supabase -v
   ```

3. **Guardar los datos que el IT de cada cliente va a pedir.** Son siempre los
   mismos para todos los clientes:
   ```bash
   supabase sso info --project-ref <project-ref>
   ```
   Devuelve `EntityID`, `Metadata URL` y `ACS URL`.

4. **Authentication → Sessions → definir Timebox o Inactivity Timeout.**
   Supabase **no soporta Single Logout**. Si el cliente saca a alguien de su
   Okta, la sesión acá sigue viva hasta que expire. Esto es el reemplazo, y un
   comprador enterprise lo pregunta.

---

## Fase 2 · Modelo de datos — yo

`supabase/migrations/20260805_sso_roster.sql`:

- `organizations.sso_provider_id uuid UNIQUE` — el UUID que devuelve
  `supabase sso add`. El JWT trae ese mismo valor en `amr[0].provider`, así que
  resolvemos "¿de qué org es esta persona?" sin preguntarle nada al usuario.
  Es el patrón que la propia documentación de Supabase recomienda para
  multi-tenant.
- `sso_roster` — el padrón. Tabla propia y no una fila en `public.users`,
  porque `users.id` es FK a `auth.users.id` y una entrada del padrón todavía no
  tiene cuenta de auth.

---

## Fase 3 · Login y aprovisionamiento — yo

**Login:** al escribir el email se mira el dominio contra las conexiones
registradas. Si hay una, en vez de pedir contraseña se llama a
`signInWithSSO({ domain })`.

**Vuelta:** `/auth/callback` ya existe y ya intercambia el código por sesión —
lo construimos para las invitaciones. No hay que tocarlo.

**Aprovisionamiento**, lo nuevo:

1. Del JWT se lee `amr[0].provider` → se resuelve la organización por
   `sso_provider_id`
2. Si ya hay perfil para ese `auth.users.id` → entra, listo
3. Si no hay perfil, se busca el email en `sso_roster` de esa org
4. Sin entrada en el padrón → `signOut()` y pantalla explicando que su
   administrador todavía no le dio acceso
5. Con entrada → se crea el perfil con sus atributos, se revalida `max_seats`
   (los asientos pueden haber bajado desde que se agregó al padrón) y se
   consume la entrada

---

## Fase 4 · Global Admin — yo

En el detalle de la organización:

- Campo para el `sso_provider_id` que devolvió el CLI
- `EntityID` y `ACS URL` copiables, para pasarle al IT del cliente
- Gateado por el add-on

Y en el CRM del cliente, dentro de Usuarios: administrar el padrón, con vista
de quién está autorizado y todavía no entró — misma forma que el badge
"Invitado" que ya existe.

---

## Fase 5 · Primer cliente — Antonio + Nicola

1. Pedirle al IT del cliente su **Metadata URL**. Okta, Azure AD y Ping la
   tienen; Google Workspace solo entrega un archivo XML.
2. ```bash
   supabase sso add --type saml --project-ref <ref> \
     --metadata-url 'https://cliente.com/idp/saml/metadata' \
     --domains cliente.com
   ```
3. Copiar el UUID que devuelve → pegarlo en Global Admin
4. Cargar a una persona real en el padrón y probar

---

## El add-on

Con la auto-unión por dominio descartada y las invitaciones ya hechas y
gratuitas, **a este add-on solo le queda SAML**. Se redefine como "SSO
empresarial (SAML)".

El fee de **$299 única vez** ahora sí corresponde a trabajo real: coordinar con
el departamento de IT de cada cliente el intercambio de metadata. No es el
código, es esa coordinación.

Supabase cobra aparte $0.015 por usuario activo mensual de SSO, con 50
incluidos. A esta escala, irrelevante.
