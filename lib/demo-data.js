const numberFormatter = new Intl.NumberFormat("en-NG");

export function formatNaira(amount) {
  return `₦${numberFormatter.format(amount)}`;
}
