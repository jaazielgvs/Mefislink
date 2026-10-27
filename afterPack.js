const { rcedit } = require('rcedit');
const path = require('path');

exports.default = async function(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.resolve('icone.ico');
  try {
    console.log('Aplicando metadados e ícone com rcedit em:', exePath);
    await rcedit(exePath, {
      icon: iconPath,
      'version-string': {
        ProductName: 'Mefislink',
        FileDescription: 'Mefislink',
        CompanyName: 'Mefis',
        LegalCopyright: 'Mefis',
        OriginalFilename: 'Mefislink.exe',
        InternalName: 'Mefislink.exe'
      }
    });
    console.log('Metadados aplicados com sucesso em Mefislink.exe!');
  } catch (err) {
    console.error('Erro ao aplicar metadados com rcedit:', err);
  }
};
