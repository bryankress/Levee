import { prisma } from "@/server/db/client";
import { evaluateCluster } from "@/server/ingest/evaluateCluster";
import { syncSensor } from "@/server/ingest/syncSensor";
import { dispatchRuleTrigger } from "@/server/notify/dispatch";

export interface PollSummary {
  sensorsSynced: number;
  sensorsFailed: number;
  clustersEvaluated: number;
  rulesNewlyTriggered: number;
  notificationsSent: number;
  notificationsFailed: number;
  errors: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One full sweep: refresh every sensor's readings, evaluate every cluster's
 * rules against them, and dispatch anything that just crossed into triggered.
 * A single sensor or cluster failing doesn't stop the rest - each is caught
 * and recorded so one bad USGS response can't blank out the whole sweep.
 */
export async function pollOnce(): Promise<PollSummary> {
  const summary: PollSummary = {
    sensorsSynced: 0,
    sensorsFailed: 0,
    clustersEvaluated: 0,
    rulesNewlyTriggered: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
    errors: [],
  };

  const sensors = await prisma.sensor.findMany();
  const syncOutcomes = await Promise.allSettled(sensors.map((sensor) => syncSensor(sensor)));
  for (const outcome of syncOutcomes) {
    if (outcome.status === "fulfilled") {
      summary.sensorsSynced++;
    } else {
      summary.sensorsFailed++;
      summary.errors.push(`sync: ${errorMessage(outcome.reason)}`);
    }
  }

  const clusters = await prisma.cluster.findMany();
  for (const cluster of clusters) {
    let evaluations;
    try {
      evaluations = await evaluateCluster(cluster.id);
    } catch (error) {
      summary.errors.push(`evaluate cluster ${cluster.id}: ${errorMessage(error)}`);
      continue;
    }
    summary.clustersEvaluated++;

    for (const evaluation of evaluations) {
      if (!evaluation.isNewTrigger) continue;
      summary.rulesNewlyTriggered++;

      try {
        const outcomes = await dispatchRuleTrigger(evaluation.ruleId, evaluation.result.message);
        for (const outcome of outcomes) {
          if (outcome.status === "SENT") summary.notificationsSent++;
          else summary.notificationsFailed++;
        }
      } catch (error) {
        summary.errors.push(`dispatch rule ${evaluation.ruleId}: ${errorMessage(error)}`);
      }
    }
  }

  return summary;
}
