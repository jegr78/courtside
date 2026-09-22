const offsetDays = Number(process.env.COURTSIDE_CLOCK_OFFSET_DAYS ?? 0);

if (Number.isFinite(offsetDays) && offsetDays !== 0) {
  const offset = offsetDays * 86_400_000;
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }

    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
}
