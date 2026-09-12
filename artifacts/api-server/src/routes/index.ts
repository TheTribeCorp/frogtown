import { Router, type IRouter } from "express";
import healthRouter from "./health";
import swampRouter from "./swamp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(swampRouter);

export default router;
