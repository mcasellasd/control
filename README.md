# Franklin Finances

Dashboard financer estàtic en català per gestionar cartera d'accions, ETFs i fons.

## Estructura

- `index.html`: interfície principal
- `styles.css`: estil visual
- `app.js`: lògica de l'aplicació
- `charts.js`: configuració de gràfics
- `data.js`: dades inicials

## Execució en local

Com que és una app estàtica, pots obrir `index.html` directament al navegador o servir-la amb un servidor local.

Exemple amb Python:

```bash
python3 -m http.server 8080
```

Després obre `http://localhost:8080`.

## Notes

- Les dades es desen al `localStorage` del navegador.
- El projecte carrega dependències externes des de CDN (Chart.js i Remix Icons).
