# Project rules

- Keep coastline and country-border GeoJSON layers separate in both pressure-map renderers; derive coastlines from ocean geometry and inland borders from shared country edges so coastal outlines are never drawn as dashed national boundaries.