/**
 * 库存换算（纯函数，便于独立核对）。
 *
 * 「件」和「套/个」是同一批货的两种记法，1 件 = packingQty 套。出库时如果套数不够扣，
 * 就把整件拆开：件数 −1、套数 +packingQty。
 *
 * 关键点：packingQty 必须用**该型号自己的**装箱数量 —— 同一货号可以高一箱 70 个、
 * 矮一箱 105 个，用错规格会算错拆箱后的散数。
 */
export function subtractStock(
  cartons: number,
  sets: number,
  outCartons: number,
  outSets: number,
  packingQty: number,
) {
  let nextCartons = cartons - outCartons;
  let nextSets = sets - outSets;
  const pack = packingQty > 0 ? packingQty : 0;
  while (nextSets < 0 && pack > 0 && nextCartons > 0) {
    nextCartons -= 1;
    nextSets += pack;
  }
  if (nextCartons < 0 || nextSets < 0) {
    throw new Error("库存不足，无法出库");
  }
  return { cartons: nextCartons, sets: nextSets };
}
