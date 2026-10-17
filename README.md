# Proyecto-Freelancer

Sitio personal de Esteban Quevedo con un panel privado de visitas e interacciones.

## Iniciar el sitio

Se necesita Node.js 18 o superior. El servidor solicita una contraseña de administrador segura mediante la variable de entorno `ADMIN_PASSWORD`; no hay una contraseña predeterminada y no debe escribirse en los archivos del proyecto.

Linux o macOS:

```sh
export ADMIN_PASSWORD='elige-una-clave-larga-y-unica-de-al-menos-16-caracteres'
npm start
```

PowerShell:

```powershell
$env:ADMIN_PASSWORD = 'elige-una-clave-larga-y-unica-de-al-menos-16-caracteres'
npm start
```

Abre `http://localhost:3000` para el sitio y `http://localhost:3000/panel.html` para iniciar sesión en el panel. También puedes acceder al panel desde el enlace «Panel de visitas» del sitio.

## Despliegue

El proyecto ahora usa un servidor Node.js (`server.js`) para proteger los datos del panel. Debe desplegarse en un servicio que ejecute Node.js y mantenga el proceso activo. GitHub Pages solo sirve archivos estáticos y no puede ejecutar este servidor: publicar allí el HTML por sí solo no protege las analíticas ni permite iniciar sesión.

En producción configura `ADMIN_PASSWORD` en las variables secretas del proveedor, usa HTTPS y conserva el directorio `data/` en un almacenamiento persistente. El servidor marca las cookies como `Secure` cuando `NODE_ENV=production`. El panel está disponible en `/panel.html`; la sesión es privada, httpOnly, SameSite Strict y caduca después de ocho horas. Los intentos de inicio de sesión tienen límite de frecuencia.

## Datos de analíticas y privacidad

El servidor registra vistas de página, interacciones con enlaces y botones fuera de formularios, página, origen del tráfico, tipo de dispositivo y fecha. No registra direcciones IP, texto escrito en formularios ni identificadores publicitarios. Los eventos se guardan en `data/events.json`, que no se sirve públicamente; ese archivo se excluye del control de versiones. El resumen permite consultar períodos de 7, 30 o 90 días. Las visitas son recuentos de páginas vistas, no usuarios únicos.
