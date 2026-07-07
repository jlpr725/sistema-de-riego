# Riego inteligente — PWA para micro:bit

## Novedades de esta versión

- **Nuevo diseño visual**, alineado a los mockups aprobados: cards con chips de ícono a color, banner de conexión que se pone verde sólido al conectar, y una card de "Acciones rápidas" con un switch para elegir Automático/Manual y un botón de encendido real para la bomba en modo Manual.
- **Iconografía con Font Awesome Free** (versión 7.0.1, vía cdnjs), en reemplazo de Tabler Icons.
- **Historial de 24 horas**: se abre con el botón del reloj (arriba a la derecha). Guarda temperatura, humedad ambiente, humedad de suelo, conductividad, estado de la bomba y modo, con gráficas de línea de las 3 primeras y una tabla debajo. Se guarda en el propio dispositivo (`localStorage`), no en un servidor.
- **Exportar CSV y Excel (.xlsx)** desde la pantalla de historial. El CSV funciona 100% offline siempre. El Excel usa una librería (SheetJS) que se descarga la primera vez que se usa esa función con conexión a internet; después queda cacheada por el service worker y funciona offline también.
- **Se quitó el editor de umbral** de la card de Humedad de Suelo: el umbral de riego automático ahora se define de forma fija en el código de la microbit, así que la app ya no lo muestra ni lo permite editar. El comando `thrNNN` sigue documentado más abajo por si en el futuro se quiere reactivar, pero la app ya no lo envía.
- **Corregidos bugs de contraste**: el input de umbral y su símbolo "%" eran invisibles (texto del mismo color que el fondo). Ya no aplica porque ese control se quitó, pero quedó resuelto para cualquier otro campo similar.
- **Corregidas las rutas de los íconos** de la app (favicon/PWA): apuntaban a una carpeta `icons/` que no existía; ahora apuntan directo a `icon-192.png` e `icon-512.png`, como están los archivos.
- **Corregido el banner de conexión que no cambiaba de estado**: la causa más probable era el service worker sirviendo una versión vieja cacheada del sitio. Ahora el service worker usa "red primero" para los archivos propios (html/css/js), así que cualquier actualización que subas al hosting se ve de inmediato, y solo sigue cacheando de forma preferente los recursos externos (fuentes, Font Awesome, SheetJS). Si ya habías abierto la app antes con la versión vieja, hacé un refresh forzado una vez (Ctrl+Shift+R o borrando datos del sitio) para que el navegador tome el nuevo service worker.
- Ahora, si falla la conexión Bluetooth, aparece un mensaje explicando el motivo en vez de simplemente volver a "Conectar" sin explicación.

### Cómo funciona el switch de modo

El interruptor de la card "Acciones rápidas" alterna entre **Automático** (apagado, la microbit riega sola según el umbral) y **Manual** (encendido). Al pasar a Manual, el cuadrado con el ícono de encendido a la izquierda se activa como botón real: tocarlo prende o apaga la bomba (comandos `bon`/`boff`). En Automático ese botón queda inerte (gris), porque la decisión la toma la microbit sola.

## Cómo probarla
1. Subí esta carpeta completa a un hosting con HTTPS (GitHub Pages, Netlify, Vercel). Web Bluetooth exige HTTPS (o `localhost`) para funcionar.
2. Abrí el sitio en **Chrome o Edge**, en PC o en Android (iOS no soporta Web Bluetooth).
3. Tocá "Conectar" y elegí tu micro:bit en la lista.
4. Podés instalarla como app (ícono "Instalar" en la barra de direcciones, o "Agregar a pantalla de inicio" en Android).

## Protocolo de comunicación (Bluetooth UART, mismo servicio que ya usabas)

### micro:bit → app
Cada 1–2 segundos, enviar un string por `bluetooth uart send string` con este formato, separado por comas:

```
temperatura,humedad_ambiente,humedad_suelo,conductividad,bomba,modo,umbral
```

| Campo | Rango | Significado |
|---|---|---|
| temperatura | entero, °C | del DHT11 |
| humedad_ambiente | entero, % | del DHT11 |
| humedad_suelo | entero, 0–100 | del sensor de suelo, ya mapeado con `map` |
| conductividad | entero, 0–100 (o el rango que uses) | del sensor EC, mapeado |
| bomba | 0 o 1 | estado actual del relé |
| modo | 0 = manual, 1 = automático | modo actual |
| umbral | entero, 0–100 | el valor de humedad de suelo bajo el cual riega en modo automático (opcional, pero recomendado para que la app lo muestre) |

Ejemplo de línea enviada: `24,58,32,41,1,1,40`

El bloque `bluetooth uart send string` ya agrega el salto de línea, así que no hace falta agregarlo manualmente.

### app → micro:bit
La app envía estos strings cortos (con salto de línea al final) por el bloque `on bluetooth uart data received` (delimitador: nueva línea):

| Comando | Acción esperada en la micro:bit |
|---|---|
| `bon` | poner modo = manual, encender relé (bomba = 1) |
| `boff` | poner modo = manual, apagar relé (bomba = 0) |
| `aon` | poner modo = automático (la micro:bit decide sola con el umbral) |
| `aoff` | poner modo = manual (mantiene el último estado de la bomba) |
| `thr` + número, ej. `thr35` | fijar el umbral de riego en 35% (parsear el número después de los primeros 3 caracteres) |

### Lógica sugerida en modo automático (dentro del loop `forever`)
```
si modo = automático:
    si humedad_suelo < umbral:
        bomba = 1, pin del relé = alto
    si no:
        bomba = 0, pin del relé = bajo
```

### Cómo parsear `thrNNN` en MakeCode
En el bloque `on bluetooth uart data received`, además de comparar el string completo contra `"bon"`, `"boff"`, `"aon"`, `"aoff"`, agregá una rama con `if (substring de texto desde 0 hasta 3) = "thr"`, y si es así, `umbral = to number (substring de texto desde el caracter 3 hasta el final)`.

## Pines sugeridos (ajustalos si ya usás otros en tu código actual)
- DHT11: P0
- Sensor de humedad de suelo (analógico): P1
- Sensor de conductividad eléctrica (analógico): P2
- Relé → motobomba (digital): P8 (evita P3, P4, P6, P7, P9, P10 — los usa la matriz de LEDs)

## Notas
- Confirmá que el bloque Bluetooth tenga activada **"no pairing required"** (ya la tenés activada, según me confirmaste).
- El campo `umbral` en el string que manda la micro:bit es opcional: si no lo mandás, la app simplemente no actualiza el input mientras no estés escribiendo en él, pero igual podés guardar un valor nuevo con el botón "Guardar" y el comando `thrNNN` va a llegar igual.
- El filtro de conexión busca dispositivos cuyo nombre empiece con "BBC micro:bit" (el nombre por defecto que le pone MakeCode). Si le cambiaste el nombre al dispositivo, avisame para ajustar el filtro.
