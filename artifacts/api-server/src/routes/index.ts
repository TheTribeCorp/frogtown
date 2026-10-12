import { Router, type IRouter } from "express";
import healthRouter from "./health";
import swampRouter from "./swamp";
import timelineRouter from "./timeline";

const router: IRouter = Router();

router.use(healthRouter);
router.use(swampRouter);
router.use(timelineRouter);

export default router;
