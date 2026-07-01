# Riego inteligente — PWA para micro:bit

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
