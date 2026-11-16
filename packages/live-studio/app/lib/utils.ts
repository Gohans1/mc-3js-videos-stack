import { createCn } from "cn/engine";

import tables from "./cn-tables";

// Precompiled from app/index.css @theme via cn build, avoiding runtime config/compiler bundling and startup compile.
export const cn = createCn(tables);
