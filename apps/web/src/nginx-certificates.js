/** Public certificate display matching only, not proof Nginx uses the certificate. */
const normalized=value=>typeof value==='string'?value.trim().toLowerCase().replace(/\.$/,''):'';
export function certificateCoversSite(certDomain,siteDomain){
  const cert=normalized(certDomain),site=normalized(siteDomain);
  if(!cert||!site||site==='_'||/[\s~]/.test(site)||/[\s~]/.test(cert))return false;
  if(cert===site)return true;
  if(!cert.startsWith('*.')||site.startsWith('*.'))return false;
  const suffix=cert.slice(2);
  return site.endsWith('.'+suffix)&&site.slice(0,-suffix.length-1).length>0
    && !site.slice(0,-suffix.length-1).includes('.');
}
export function matchingCertificates(certificates,siteDomains){
  if(!Array.isArray(certificates)||!Array.isArray(siteDomains))return [];
  return certificates.filter(cert=>Array.isArray(cert.domains)&&
    cert.domains.some(certDomain=>siteDomains.some(siteDomain=>
      certificateCoversSite(certDomain,siteDomain))));
}
