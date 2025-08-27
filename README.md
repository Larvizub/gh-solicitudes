# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Notificaciones de Tickets por Correo

Se integró un flujo para enviar correos (Microsoft Graph) cuando:
1. Se crea un ticket.
2. Cambia el estado.
3. Cambia la prioridad.
4. Cambia el campo asignadoA.

### Requisitos
Configurar en Firebase Functions (`functions:config:set`):
- msgraph.tenant_id
- msgraph.client_id
- msgraph.client_secret
- msgraph.sender (correo patrón) y msgraph.senderid (Object ID recomendado)

En el frontend define en `.env` (o variables Vite) – ver `.env.example`:
```
VITE_SENDMAIL_URL=https://<region>-<project>.cloudfunctions.net/sendMail
```

### Cómo funciona
Al guardar un ticket en `Tickets.jsx`, si es creación o cambia el campo `estado`, se genera HTML con `generateTicketEmailHTML` y se envía al endpoint HTTPS `sendMail` junto con los datos mínimos: `ticketId, departamento, tipo, estado, descripcion, usuarioEmail, html` (más `subject` y `actionMsg`).

El backend ya no construye plantillas: el campo `html` es obligatorio.

### Personalización de plantilla
Edita `src/utils/ticketEmailTemplate.js` para cambiar estilos, logos o layout sin redeploy de la función.

### Errores comunes
- 415: Falta header Content-Type application/json.
- 400: Faltan campos obligatorios.
- 500: Credenciales MS Graph incorrectas o falta `html`.

### Próximos pasos sugeridos
- Añadir sanitización/validación extra del HTML en frontend.
- Implementar API Key (`functions.config().api.key`) y enviarla con encabezado `x-api-key`.
- Log de auditoría de intentos fallidos.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
# gh-solicitudes
