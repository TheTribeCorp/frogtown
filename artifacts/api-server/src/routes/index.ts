import { Router, type IRouter } from "express";
import healthRouter from "./health";
import swampRouter from "./swamp";
import timelineRouter from "./timeline";
import gamificationRouter from "./gamification";
import hermitMarketRouter from "./hermit-market";

const router: IRouter = Router();

router.use(healthRouter);
router.use(swampRouter);
router.use(timelineRouter);
router.use(gamificationRouter);
router.use(hermitMarketRouter);

export default router;
