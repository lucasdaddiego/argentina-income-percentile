# Metodología

Fuente única: microdatos de la **Encuesta Permanente de Hogares (EPH)**, INDEC — base usuaria del
**4º trimestre de 2025** (`EPH_usu_4_Trim_2025_txt.zip`, fijada por SHA-256). Se eligió el 4º trimestre
porque, a diferencia del 1º y 3º, **no está afectado por el aguinaldo**, por lo que refleja mejor el
ingreso "típico".

## Variables y ponderadores

| Concepto | Variable | Ponderador | Universo |
|---|---|---|---|
| Ingreso personal (titular) | `P47T` | `PONDII` | Personas con ingresos individuales (perceptores) |
| Ingreso per cápita familiar | `IPCF` | `PONDIH` | Población total (incluye hogares sin ingresos) |

Se usan los ponderadores **corregidos por no respuesta** (`PONDII`/`PONDIH`), nunca `PONDERA`, que es
el error estadístico habitual. Las columnas `IPCF`/`ITF` vienen con decimales separados por coma
(`N(10,2)`), por lo que se leen con `decimal=","`.

## Tratamiento de casos

- `-9` (no respuesta de monto) → faltante.
- Etiqueta de decil `12` (no respuesta) y `13` (entrevista no realizada) → se excluyen siempre.
- `IPCF`: las personas sin ingresos (código `00`) quedan al **inicio del decil 1** (criterio INDEC).
- Ingreso personal: solo **perceptores** (se excluye "sin ingresos").

## Cálculos

- **Percentiles / deciles**: inversión de la CDF empírica ponderada (tipo 1, sin interpolar de más),
  contrastada contra `numpy.quantile(method='inverted_cdf', weights=...)`.
- **Media / mediana por decil**: ponderadas por el factor de expansión.
- **Gini**: área trapezoidal entre la diagonal de igualdad y la **curva de Lorenz** de los datos.
- **Histograma**: recuentos ponderados en intervalos fijos de 0 al percentil 99,9; la cola superior se
  agrupa en el último intervalo.

## Pobreza

La app compara el **ingreso por persona del hogar** con la Canasta Básica por adulto:

- **CBA** (línea de indigencia) y **CBT** (línea de pobreza) por adulto equivalente, valores oficiales
  de INDEC de **octubre 2025**: CBA `$176.150`, CBT `$392.815`. Se elige octubre 2025 para que el período
  de la canasta coincida con el de los ingresos (EPH 4º trim. 2025); comparar contra una canasta
  posterior, ya inflada, subestimaría los ingresos reales.
- **Simplificación:** se cuenta a cada integrante como un adulto equivalente. La metodología oficial de
  INDEC (Nº 22, Anexo 7.1) pondera por sexo y edad, por lo que en hogares con menores el umbral real es
  algo más bajo. Esa escala **no** está en el artefacto: un cálculo más fino requiere incorporarla
  primero al pipeline.
- Las canastas se actualizan **mensualmente** (independiente del trimestre de la EPH), por eso viven en
  su propio bloque del artefacto.

## Validación

El pipeline reproduce las cifras publicadas por INDEC ("Evolución de la distribución del ingreso (EPH),
4º trim. 2025") para el IPCF: Gini **0,427**, mediana **$450.000**, media **$635.996**, población
**30.032.540**, y todos los límites de decil ("hasta") al peso. El ingreso personal (`P47T`) se
contrasta además contra las etiquetas de decil oficiales del propio microdato (`DECINDR`).

> Elaboración propia en base a microdatos de la Encuesta Permanente de Hogares (EPH), INDEC.
> Fuente: INDEC, www.indec.gob.ar.
