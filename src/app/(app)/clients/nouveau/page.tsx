import { BackLink, Flash } from '@/components';
import { createClient } from '@/server/actions/crm';
import { requireCtx } from '@/server/context';

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const { t } = await requireCtx();
  const sp = await searchParams;
  return (
    <form action={createClient} className="page">
      <div className="row">
        <BackLink href="/clients" label={t.common.back} />
        <h1>{t.clients.newTitle}</h1>
      </div>
      {sp.ok && <Flash>{t.common.saved}</Flash>}
      {sp.erreur && <Flash kind="bad">{t.common.error}</Flash>}
      <label className="field">{t.clients.name}<input type="text" name="name" id="name" required autoFocus /></label>
      <label className="field">{t.clients.group} <span className="faint">({t.common.optional})</span><input type="text" name="group" id="group" /></label>
      <label className="field">{t.clients.address}<input type="text" name="address" id="address" autoComplete="street-address" /></label>
      <div className="grid2">
        <label className="field">{t.clients.postalCode}<input type="text" name="postalCode" id="postalCode" inputMode="numeric" /></label>
        <label className="field">{t.clients.city}<input type="text" name="city" id="city" /></label>
      </div>
      <div className="grid2 stack-sm">
        <label className="field">{t.clients.contact}<input type="text" name="contact" id="contact" /></label>
        <label className="field">{t.clients.phone}<input type="tel" name="phone" id="phone" /></label>
      </div>
      <label className="field">{t.clients.email}<input type="email" name="email" id="email" /></label>
      <fieldset>
        <legend>{t.clients.category}</legend>
        <div className="choices">
          {['A', 'B', 'C'].map((c) => (
            <label key={c} className="choice"><input type="radio" name="category" value={c} defaultChecked={c === 'B'} /><span>{c}</span></label>
          ))}
        </div>
        <p className="faint" style={{ marginTop: 6 }}>{t.clients.categoryHint}</p>
      </fieldset>
      <label className="field">{t.clients.notes}<textarea name="notes" id="notes" rows={3} /></label>
      <button className="btn primary block" type="submit">{t.common.save}</button>
      <button className="btn block" type="submit" name="another" value="1">{t.clients.saveAndAdd}</button>
    </form>
  );
}
