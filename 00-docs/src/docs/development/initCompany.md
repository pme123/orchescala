{%
helium.site.pageNavigation.enabled = false
%}
# Init Company
**Experimental**

Create the directory structure and common files to get you started with _Orchescala_.

The Structure of the Process-Projects looks like this:
```
myProject1  myProject2  ...
      |         |         |
     company-orchescala
            |  
        orchescala
```

The idea is that you have a company layer, where you can override Company specific settings.

@:callout(info)
**Be aware** that one of the main advantages is the concept of _Convention over Configuration_.

At the moment not everything is configurable.

So try to stick to the conventions, whenever possible.
@:@


1. Create a directory for your company development:
```bash
mkdir ~/dev-mycompany
```

  Be aware that the company name (_mycompany_) must be lowercase to work properly.

1. Create `helperCompany.scala` in your company directory and open it.
```bash
cd ~/dev-mycompany
touch helperCompany.scala
open helperCompany.scala
```

1. Copy the following content to `helperCompany.scala`:
   ```scala mdoc
   #!/usr/bin/env -S scala shebang
   // DO NOT ADJUST. This file is replaced by `./helper.scala update`.

   //> using toolkit 0.5.0
   //> using dep io.github.pme123::orchescala-helper:@VERSION@
   
   import orchescala.helper.dev.DevCompanyHelper
   
   @main
   def run(command: String, arguments: String*): Unit =
     DevCompanyHelper.run(command, arguments*)
   ```

1. Make the file executable:
```bash
chmod +x helperCompany.scala
```

1. Create the company directory structure:
```bash
./helperCompany.scala init
```

1. Open the `company-orchescala` directory with your IDE (I use Intellij).
1. Import the sbt project. The project should compile without errors.
1. Update `build.sbt` with your repository settings.
1. Release the `company-orchescala` project to your repository.

### Next Step: [Create Project]
