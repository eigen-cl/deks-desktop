import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// La limpieza automática de Testing Library sólo se registra sola cuando Vitest
// expone sus globales. Aquí no lo hace, así que sin esto cada `render` deja su
// árbol en el documento y la consulta del test siguiente encuentra dos.
afterEach(cleanup);
