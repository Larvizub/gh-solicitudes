# Ticket Mail Backend (Firebase Functions)

Descripción
- Backend en Firebase Functions que expone un endpoint HTTP para enviar notificaciones por correo (usando Microsoft Graph).
- Implementado como una API (Express) desplegada en `functions:api`.

Endpoints
- POST https://REGION-PROJECT.cloudfunctions.net/api/sendMail
  - Propósito: enviar un correo relacionado con un ticket.
  - Cabeceras:
    - Content-Type: application/json
    - (Opcional) x-api-key: <API_KEY> — si configura `api.key` para protección adicional.

Payload JSON (requeridos / opcionales)
- Requeridos:
  - ticketId (string)
  - departamento (string)
  - tipo (string)
  - estado (string)
- Opcionales:
  - descripcion (string)
  - subcategoria (string)
  - prioridad (string)
  - usuarioEmail (string)
  - extraRecipients (array of strings)

Ejemplo de petición (curl)
```
curl -X POST "https://REGION-PROJECT.cloudfunctions.net/api/sendMail" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "ticketId": "12345",
    "departamento": "Soporte",
    "tipo": "Incidente",
    "estado": "Abierto",
    "descripcion": "Descripción breve del problema",
    "extraRecipients": ["ops@dominio.com"]
  }'
```

Respuestas típicas
- 200 OK — { success: true, messageId: "<id_del_mensaje>" }
- 400 Bad Request — campos faltantes o formato inválido
- 401 Unauthorized — API key inválida (si configurada)
- 500 Internal Server Error — error en envío o configuración

Variables de configuración (Firebase Functions config)
```
firebase functions:config:set \
  msgraph.tenant_id="<TENANT_ID>" \
  msgraph.client_id="<CLIENT_ID>" \
  msgraph.client_secret="<CLIENT_SECRET>" \
  msgraph.sender="remitente@dominio.com" \
  app.url="https://tu-app.web.app" \
  allowed.origins="https://tu-app.web.app,https://localhost:5173" \
  api.key="<OPCIONAL_API_KEY>"
```
- msgraph.*: credenciales de la app registrada en Azure AD para enviar correo por Microsoft Graph.
- msgraph.sender: dirección desde la que se envían los correos.
- allowed.origins: lista separada por comas usada para CORS.
- api.key: opcional; si se establece, la API espera `x-api-key` en la petición.

Despliegue
- Asegúrese de configurar las variables con `firebase functions:config:set` antes de desplegar.
- Desplegar funciones:
```
firebase deploy --only functions:api
```

Desarrollo local y pruebas
- Usar el emulador de Firebase para probar localmente:
```
firebase emulators:start --only functions
```
- Revisar logs para depuración:
```
firebase functions:log
```

Seguridad y buenas prácticas
- Mantener `msgraph.client_secret` fuera del control de versiones.
- Usar `api.key` o autenticación adicional para proteger el endpoint público.
- Restringir `allowed.origins` a los dominios de confianza para evitar CORS no deseado.

Notas
- El envío de correo se realiza mediante la cuenta configurada en `msgraph.sender` a través de Microsoft Graph.
- Ajustar mensajes y plantillas según las necesidades del ticketing.

Contacto / Soporte
- luis.arvizu@costaricacc.com 
- douglas.granados@costaricacc.com, douglas.granados@grupoheroica.com
