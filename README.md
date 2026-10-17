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

## Despliegue online en Render

El archivo `render.yaml` configura un servicio Node.js de pago siempre activo, despliegue automático al subir cambios a GitHub, comprobación de estado en `/healthz` y almacenamiento persistente para las estadísticas. Render genera `ADMIN_PASSWORD` como variable secreta; consúltala en la configuración del servicio para iniciar sesión en el panel.

Para publicar el sitio, conecta este repositorio en Render y crea un Blueprint usando `render.yaml`. Al terminar el despliegue, Render proporcionará la URL pública del sitio; el panel estará disponible en esa URL seguida de `/panel.html`. El servicio requiere un plan compatible con disco persistente. El archivo de configuración prepara el despliegue, pero no crea ni activa el servicio sin una cuenta de Render conectada.

GitHub Pages solo sirve archivos estáticos y no puede ejecutar el servidor ni proteger la API. Añadir archivos al repositorio no activa por sí solo un despliegue ni configura un dominio.

Las sesiones duran ocho horas y usan cookies httpOnly y SameSite Strict. Los intentos de inicio de sesión tienen límite de frecuencia.

## Datos de analíticas y privacidad

El servidor registra vistas de página, interacciones con enlaces y botones fuera de formularios, página, origen del tráfico, tipo de dispositivo y fecha. No registra direcciones IP, texto escrito en formularios ni identificadores publicitarios. Los eventos se guardan en `data/events.json` (o en el directorio definido por `DATA_DIR`); ese archivo se excluye del control de versiones. El resumen permite consultar períodos de 7, 30 o 90 días. Las visitas son recuentos de páginas vistas, no usuarios únicos.
